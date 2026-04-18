import { getDB } from './db';
import { TaskCompletion, DisplayTask } from '@/types/database';
import {
    format, isSameDay, addDays, getDay,
    endOfMonth, isBefore, startOfDay,
} from 'date-fns';
import { extractTimeInMinutes, hasTimeInTitle } from './timeUtils';

// D1でのIN句用プレースホルダー生成ヘルパー
function inPlaceholders(count: number): string {
    return Array.from({ length: count }, () => '?').join(',');
}

// weekdays: D1ではTEXT(JSON)で保存。読み取り時にパース
function parseWeekdays(raw: string | null | undefined): number[] | null {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// 指定した日のタスクを取得
export async function getTasksForDate(
    userId: string,
    targetDate: Date
): Promise<DisplayTask[]> {
    const db = await getDB();
    const dateStr = format(targetDate, 'yyyy-MM-dd');

    // 1. すべてのタスクを取得（繰り返し設定も含む）
    const { results: tasks } = await db
        .prepare(`
            SELECT
                t.id, t.user_id, t.title, t.due_date, t.notification_time, t.created_at,
                tr.type as recurrence_type, tr.custom_days, tr.custom_unit,
                tr.weekdays as recurrence_weekdays
            FROM tasks t
            LEFT JOIN task_recurrences tr ON t.id = tr.task_id
            WHERE t.user_id = ?
            ORDER BY t.created_at ASC
        `)
        .bind(userId)
        .all<any>();

    const displayTasks: DisplayTask[] = [];

    // 2. 繰り返しタスクのIDを収集して除外日を取得
    const recurringTaskIds = tasks.filter(t => t.recurrence_type).map(t => t.id);
    const exclusionsMap = await getTaskExclusionsBatch(db, recurringTaskIds);

    // 3. 表示対象ペアを収集して完了状態を一括取得
    const completionPairs: Array<{ taskId: string; date: Date }> = [];
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                completionPairs.push({ taskId: task.id, date: targetDate });
            }
        } else {
            const weekdays = parseWeekdays(task.recurrence_weekdays);
            const exclusions = exclusionsMap.get(task.id) || null;
            if (shouldIncludeRecurringTaskWithExclusions(
                task.id, task.recurrence_type, taskDueDate, targetDate,
                task.custom_days, task.custom_unit, weekdays, exclusions
            )) {
                completionPairs.push({ taskId: task.id, date: targetDate });
            }
        }
    }

    const completionsMap = await getTaskCompletionsBatch(db, completionPairs);

    // 3.5. この日付から引継ぎ完了されたタスクを特定（元の日付から除外するため）
    const targetTaskIds = completionPairs.map(p => p.taskId);
    const carryoverAwaySet = await getCarryoverAwayTaskIds(db, targetTaskIds, dateStr);

    // 4. 表示用タスクリストを作成
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
        const weekdays = parseWeekdays(task.recurrence_weekdays);

        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                // 引継ぎ完了で別の日に移動済みなら除外
                if (carryoverAwaySet.has(task.id)) continue;
                const completion = completionsMap.get(`${task.id}_${dateStr}`);
                displayTasks.push({
                    id: `single-${task.id}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: completion?.completed || false,
                    is_recurring: false,
                    created_at: new Date(task.created_at),
                });
            }
        } else {
            const exclusions = exclusionsMap.get(task.id) || null;
            if (shouldIncludeRecurringTaskWithExclusions(
                task.id, task.recurrence_type, taskDueDate, targetDate,
                task.custom_days, task.custom_unit, weekdays, exclusions
            )) {
                // 引継ぎ完了で別の日に移動済みなら除外
                if (carryoverAwaySet.has(`${task.id}_${dateStr}`)) continue;
                const completion = completionsMap.get(`${task.id}_${dateStr}`);
                displayTasks.push({
                    id: `recurring-${task.id}-${dateStr}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: completion?.completed || false,
                    is_recurring: true,
                    created_at: new Date(task.created_at),
                });
            }
        }
    }

    // 5. ソート
    return sortDisplayTasks(displayTasks);
}

// 日付範囲を指定してタスクを取得
export async function getTasksForDateRange(
    userId: string,
    startDate: Date,
    endDate: Date
): Promise<Map<string, DisplayTask[]>> {
    const tasksByDate = new Map<string, DisplayTask[]>();
    const dates: Date[] = [];
    let currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    const endDateNormalized = new Date(endDate);
    endDateNormalized.setHours(23, 59, 59, 999);
    while (currentDate <= endDateNormalized) {
        dates.push(new Date(currentDate));
        currentDate = addDays(currentDate, 1);
    }
    const tasksArrays = await Promise.all(dates.map(date => getTasksForDate(userId, date)));
    dates.forEach((date, index) => {
        tasksByDate.set(format(date, 'yyyy-MM-dd'), tasksArrays[index]);
    });
    return tasksByDate;
}

// 基本情報のみ取得（完了状態なし）
export async function getTasksBasicForDate(
    userId: string,
    targetDate: Date
): Promise<DisplayTask[]> {
    const db = await getDB();
    const dateStr = format(targetDate, 'yyyy-MM-dd');

    const { results: tasks } = await db
        .prepare(`
            SELECT
                t.id, t.user_id, t.title, t.due_date, t.notification_time, t.created_at,
                tr.type as recurrence_type, tr.custom_days, tr.custom_unit,
                tr.weekdays as recurrence_weekdays
            FROM tasks t
            LEFT JOIN task_recurrences tr ON t.id = tr.task_id
            WHERE t.user_id = ?
            ORDER BY t.created_at ASC
        `)
        .bind(userId)
        .all<any>();

    const displayTasks: DisplayTask[] = [];
    const recurringTaskIds = tasks.filter(t => t.recurrence_type).map(t => t.id);
    const exclusionsMap = await getTaskExclusionsBatch(db, recurringTaskIds);

    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
        const weekdays = parseWeekdays(task.recurrence_weekdays);

        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                displayTasks.push({
                    id: `single-${task.id}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: false,
                    is_recurring: false,
                    created_at: new Date(task.created_at),
                });
            }
        } else {
            const exclusions = exclusionsMap.get(task.id) || null;
            if (shouldIncludeRecurringTaskWithExclusions(
                task.id, task.recurrence_type, taskDueDate, targetDate,
                task.custom_days, task.custom_unit, weekdays, exclusions
            )) {
                displayTasks.push({
                    id: `recurring-${task.id}-${dateStr}`,
                    task_id: task.id,
                    title: task.title,
                    date: targetDate,
                    due_date: taskDueDate,
                    notification_time: task.notification_time || undefined,
                    completed: false,
                    is_recurring: true,
                    created_at: new Date(task.created_at),
                });
            }
        }
    }

    return sortDisplayTasks(displayTasks);
}

// 完了状態を付与
export async function updateTasksWithCompletionStatus(
    tasks: DisplayTask[],
    userId: string,
    targetDate: Date
): Promise<DisplayTask[]> {
    if (tasks.length === 0) return tasks;
    const db = await getDB();
    const dateStr = format(targetDate, 'yyyy-MM-dd');
    const completionPairs = tasks.map(task => ({ taskId: task.task_id, date: targetDate }));
    const completionsMap = await getTaskCompletionsBatch(db, completionPairs);
    return tasks.map(task => {
        const completion = completionsMap.get(`${task.task_id}_${dateStr}`);
        return { ...task, completed: completion?.completed || false };
    });
}

// 指定日のタスク + 引継ぎタスク（今日 or 過去）を一括取得
// 既存の getTasksForDate + getCarryoverTasks + getCarryoverCompletedTasksForDate を統合し、
// tasks/exclusions の重複SELECTを排除、完了系クエリを並列化して DB roundtrip を約3倍短縮
export async function getTasksForDateUnified(
    userId: string,
    targetDate: Date,
    todayJST: Date
): Promise<DisplayTask[]> {
    const db = await getDB();
    const targetDateStart = startOfDay(targetDate);
    const todayStart = startOfDay(todayJST);
    const targetDateStr = format(targetDateStart, 'yyyy-MM-dd');
    const todayStr = format(todayStart, 'yyyy-MM-dd');
    const isToday = isSameDay(targetDateStart, todayStart);
    const isPast = isBefore(targetDateStart, todayStart);

    // Step 1: タスク + 繰り返し（1クエリ）
    const { results: tasks } = await db
        .prepare(`
            SELECT
                t.id, t.user_id, t.title, t.due_date, t.notification_time, t.created_at,
                tr.type as recurrence_type, tr.custom_days, tr.custom_unit,
                tr.weekdays as recurrence_weekdays
            FROM tasks t
            LEFT JOIN task_recurrences tr ON t.id = tr.task_id
            WHERE t.user_id = ?
            ORDER BY t.created_at ASC
        `)
        .bind(userId)
        .all<any>();

    if (tasks.length === 0) return [];

    // Step 2: 除外日（1クエリ）
    const recurringTaskIds = tasks.filter(t => t.recurrence_type).map(t => t.id);
    const exclusionsMap = await getTaskExclusionsBatch(db, recurringTaskIds);

    // Step 3: targetDate に該当するタスクを収集
    const targetMatching: any[] = [];
    for (const task of tasks) {
        const taskDueDate = startOfDay(new Date(task.due_date));
        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDateStart)) targetMatching.push(task);
        } else {
            const weekdays = parseWeekdays(task.recurrence_weekdays);
            const exclusions = exclusionsMap.get(task.id) || null;
            if (shouldIncludeRecurringTaskWithExclusions(
                task.id, task.recurrence_type, taskDueDate, targetDateStart,
                task.custom_days, task.custom_unit, weekdays, exclusions
            )) targetMatching.push(task);
        }
    }

    // Step 4: 今日のみ – 引継ぎ候補を収集（過去30日）
    const carryoverPairs: Array<{ task: any; originalDate: Date }> = [];
    if (isToday) {
        const thirtyDaysAgo = addDays(todayStart, -30);
        for (const task of tasks) {
            const taskDueDate = startOfDay(new Date(task.due_date));
            if (!task.recurrence_type) {
                if (isBefore(taskDueDate, todayStart) && !isBefore(taskDueDate, thirtyDaysAgo)) {
                    carryoverPairs.push({ task, originalDate: taskDueDate });
                }
            } else {
                if (isBefore(taskDueDate, todayStart)) {
                    const exclusions = exclusionsMap.get(task.id) || null;
                    const weekdays = parseWeekdays(task.recurrence_weekdays);
                    let checkDate = new Date(thirtyDaysAgo);
                    while (isBefore(checkDate, todayStart)) {
                        if (shouldIncludeRecurringTaskWithExclusions(
                            task.id, task.recurrence_type, taskDueDate, checkDate,
                            task.custom_days, task.custom_unit, weekdays, exclusions
                        )) {
                            carryoverPairs.push({ task, originalDate: new Date(checkDate) });
                        }
                        checkDate = addDays(checkDate, 1);
                    }
                }
            }
        }
    }

    // Step 5: 完了系を並列取得（最大3クエリ並列）
    const completionPairs: Array<{ taskId: string; date: Date }> = [
        ...targetMatching.map(t => ({ taskId: t.id, date: targetDateStart })),
        ...carryoverPairs.map(p => ({ taskId: p.task.id, date: p.originalDate })),
    ];
    const targetMatchingIds = targetMatching.map(t => t.id);
    const carryoverTaskIds = carryoverPairs.map(p => p.task.id);

    const [completionsMap, carryoverRowsForToday, awaySet, pastCarryoverRows] = await Promise.all([
        getTaskCompletionsBatch(db, completionPairs),
        isToday
            ? getCarryoverCompletionsBatch(db, carryoverTaskIds)
            : Promise.resolve(new Map<string, { completed: boolean; completed_date: string }>()),
        isPast
            ? getCarryoverAwayTaskIds(db, targetMatchingIds, targetDateStr)
            : Promise.resolve(new Set<string>()),
        isPast
            ? getPastCarryoverCompletedForDate(db, userId, targetDateStr)
            : Promise.resolve([] as Array<{ task_id: string; carryover_from_date: string }>),
    ]);

    // Step 6: targetDate のタスクを DisplayTask に変換
    const displayTasks: DisplayTask[] = [];
    for (const task of targetMatching) {
        const taskDueDate = startOfDay(new Date(task.due_date));
        const isRecurring = !!task.recurrence_type;
        if (!isRecurring && awaySet.has(task.id)) continue;
        if (isRecurring && awaySet.has(`${task.id}_${targetDateStr}`)) continue;

        const completion = completionsMap.get(`${task.id}_${targetDateStr}`);
        displayTasks.push({
            id: isRecurring ? `recurring-${task.id}-${targetDateStr}` : `single-${task.id}`,
            task_id: task.id,
            title: task.title,
            date: targetDate,
            due_date: taskDueDate,
            notification_time: task.notification_time || undefined,
            completed: completion?.completed || false,
            is_recurring: isRecurring,
            created_at: new Date(task.created_at),
        });
    }
    const sortedTarget = sortDisplayTasks(displayTasks);

    // Step 7: 今日 – 引継ぎタスクを末尾に追加
    if (isToday) {
        const carryoverTasks: DisplayTask[] = [];
        for (const { task, originalDate } of carryoverPairs) {
            const originalDateStr = format(originalDate, 'yyyy-MM-dd');
            const completionOnOriginal = completionsMap.get(`${task.id}_${originalDateStr}`);
            if (completionOnOriginal?.completed) continue;

            const carryoverCompletion = carryoverRowsForToday.get(`${task.id}_${originalDateStr}`);
            if (carryoverCompletion?.completed && carryoverCompletion.completed_date !== todayStr) continue;

            const isCompletedAsCarryover = !!carryoverCompletion?.completed;
            const taskDueDate = startOfDay(new Date(task.due_date));
            carryoverTasks.push({
                id: `carryover-${task.id}-${originalDateStr}`,
                task_id: task.id,
                title: task.title,
                date: todayJST,
                due_date: taskDueDate,
                notification_time: task.notification_time || undefined,
                completed: isCompletedAsCarryover,
                is_recurring: !!task.recurrence_type,
                is_carryover: true,
                original_date: originalDate,
                created_at: new Date(task.created_at),
            });
        }
        const sortedCarryover = carryoverTasks
            .sort((a, b) => a.original_date!.getTime() - b.original_date!.getTime())
            .slice(0, 50);
        return [...sortedTarget, ...sortedCarryover];
    }

    // Step 8: 過去日付 – その日に完了された引継ぎタスクを末尾に追加
    if (isPast && pastCarryoverRows.length > 0) {
        const taskMap = new Map<string, any>();
        for (const t of tasks) taskMap.set(t.id, t);

        const pastCarryoverTasks: DisplayTask[] = [];
        for (const row of pastCarryoverRows) {
            const task = taskMap.get(row.task_id);
            if (!task) continue;
            const originalDate = startOfDay(new Date(row.carryover_from_date));
            const taskDueDate = startOfDay(new Date(task.due_date));
            pastCarryoverTasks.push({
                id: `carryover-${task.id}-${row.carryover_from_date}`,
                task_id: task.id,
                title: task.title,
                date: targetDate,
                due_date: taskDueDate,
                notification_time: task.notification_time || undefined,
                completed: true,
                is_recurring: !!task.recurrence_type,
                is_carryover: true,
                original_date: originalDate,
                created_at: new Date(task.created_at),
            });
        }
        return [...sortedTarget, ...pastCarryoverTasks];
    }

    return sortedTarget;
}

// タスクの完了状態を更新
// carryoverFromDate: 引継ぎタスクの場合、元の日付を指定（completedDateは今日、carryoverFromDateは元の日付）
export async function toggleTaskCompletion(
    taskId: string,
    date: Date,
    completed: boolean,
    carryoverFromDate?: string
): Promise<void> {
    const db = await getDB();
    const dateStr = format(date, 'yyyy-MM-dd');
    const now = new Date().toISOString();

    // 引継ぎタスクの場合、元の日付の完了レコードと過去のcarryoverレコードを削除（重複防止）
    if (carryoverFromDate && carryoverFromDate !== dateStr) {
        await db.batch([
            db.prepare('DELETE FROM task_completions WHERE task_id = ? AND completed_date = ?')
                .bind(taskId, carryoverFromDate),
            db.prepare('DELETE FROM task_completions WHERE task_id = ? AND carryover_from_date = ?')
                .bind(taskId, carryoverFromDate),
        ]);
    }

    const existing = await db
        .prepare('SELECT id FROM task_completions WHERE task_id = ? AND completed_date = ? LIMIT 1')
        .bind(taskId, dateStr)
        .first<{ id: string }>();

    if (existing) {
        await db
            .prepare('UPDATE task_completions SET completed = ?, carryover_from_date = ?, updated_at = ? WHERE task_id = ? AND completed_date = ?')
            .bind(completed ? 1 : 0, carryoverFromDate || null, now, taskId, dateStr)
            .run();
    } else {
        const id = crypto.randomUUID();
        await db
            .prepare('INSERT INTO task_completions (id, task_id, completed_date, completed, carryover_from_date) VALUES (?, ?, ?, ?, ?)')
            .bind(id, taskId, dateStr, completed ? 1 : 0, carryoverFromDate || null)
            .run();
    }
}

// 繰り返しタスクが指定日に該当するかチェック（D1用: exclusionsを引数で受け取る）
export function shouldIncludeRecurringTaskWithExclusions(
    taskId: string,
    recurrenceType: string,
    taskDueDate: Date,
    targetDate: Date,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null,
    exclusions: Array<{ excluded_date: Date; exclusion_type: string }> | null
): boolean {
    if (targetDate < taskDueDate) return false;

    if (exclusions) {
        for (const ex of exclusions) {
            if (ex.exclusion_type === 'single' && isSameDay(ex.excluded_date, targetDate)) return false;
            if (ex.exclusion_type === 'after' && targetDate >= ex.excluded_date) return false;
        }
    }

    if (isSameDay(taskDueDate, targetDate)) return true;

    switch (recurrenceType) {
        case 'daily': return true;
        case 'weekly': return getDay(taskDueDate) === getDay(targetDate);
        case 'monthly': return taskDueDate.getDate() === targetDate.getDate();
        case 'monthly_end': return isSameDay(targetDate, endOfMonth(targetDate));
        case 'yearly':
            return taskDueDate.getMonth() === targetDate.getMonth() &&
                taskDueDate.getDate() === targetDate.getDate();
        case 'weekdays':
            if (!weekdays || weekdays.length === 0) return false;
            return weekdays.includes(getDay(targetDate));
        case 'custom':
            if (!customDays || customDays <= 0) return false;
            if (!customUnit || customUnit === 'days') {
                const daysDiff = Math.floor((targetDate.getTime() - taskDueDate.getTime()) / 86400000);
                return daysDiff >= 0 && daysDiff % customDays === 0;
            }
            if (customUnit === 'weeks') {
                const daysDiff = Math.floor((targetDate.getTime() - taskDueDate.getTime()) / 86400000);
                return daysDiff >= 0 && daysDiff % (customDays * 7) === 0;
            }
            if (customUnit === 'months') {
                if (taskDueDate.getDate() !== targetDate.getDate()) return false;
                const monthsDiff = (targetDate.getFullYear() - taskDueDate.getFullYear()) * 12 +
                    (targetDate.getMonth() - taskDueDate.getMonth());
                return monthsDiff >= 0 && monthsDiff % customDays === 0;
            }
            if (customUnit === 'months_end') {
                if (!isSameDay(targetDate, endOfMonth(targetDate))) return false;
                const monthsDiff = (targetDate.getFullYear() - taskDueDate.getFullYear()) * 12 +
                    (targetDate.getMonth() - taskDueDate.getMonth());
                return monthsDiff >= 0 && monthsDiff % customDays === 0;
            }
            if (customUnit === 'years') {
                if (taskDueDate.getMonth() !== targetDate.getMonth() ||
                    taskDueDate.getDate() !== targetDate.getDate()) return false;
                const yearsDiff = targetDate.getFullYear() - taskDueDate.getFullYear();
                return yearsDiff >= 0 && yearsDiff % customDays === 0;
            }
            return false;
        default: return false;
    }
}

// 複数の完了状態を一括取得（D1対応）
async function getTaskCompletionsBatch(
    db: D1Database,
    taskIdDatePairs: Array<{ taskId: string; date: Date }>
): Promise<Map<string, TaskCompletion>> {
    if (taskIdDatePairs.length === 0) return new Map();

    const completionMap = new Map<string, TaskCompletion>();
    const taskIds = [...new Set(taskIdDatePairs.map(p => p.taskId))];
    const dateStrs = [...new Set(taskIdDatePairs.map(p => format(p.date, 'yyyy-MM-dd')))];

    if (taskIds.length === 0 || dateStrs.length === 0) return completionMap;

    const pairSet = new Set(taskIdDatePairs.map(p => `${p.taskId}_${format(p.date, 'yyyy-MM-dd')}`));

    const processRows = (results: any[]) => {
        for (const row of results) {
            const completedDateStr = typeof row.completed_date === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(row.completed_date)
                ? row.completed_date
                : format(new Date(row.completed_date), 'yyyy-MM-dd');
            const key = `${row.task_id}_${completedDateStr}`;
            if (pairSet.has(key)) {
                completionMap.set(key, {
                    id: row.id,
                    task_id: row.task_id,
                    completed_date: new Date(row.completed_date),
                    completed: row.completed === 1,
                    created_at: new Date(row.created_at),
                    updated_at: row.updated_at ? new Date(row.updated_at) : new Date(row.created_at),
                });
            }
        }
    };

    // D1のバインドパラメータ上限(100)を超えないようにバッチ分割
    // taskIds と dateStrs の両方をバッチ分割する
    const BATCH_SIZE = 50;
    const taskIdBatches: string[][] = [];
    for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
        taskIdBatches.push(taskIds.slice(i, i + BATCH_SIZE));
    }
    const dateBatches: string[][] = [];
    for (let i = 0; i < dateStrs.length; i += BATCH_SIZE) {
        dateBatches.push(dateStrs.slice(i, i + BATCH_SIZE));
    }

    for (const taskIdBatch of taskIdBatches) {
        for (const dateBatch of dateBatches) {
            const { results } = await db
                .prepare(
                    `SELECT * FROM task_completions WHERE task_id IN (${inPlaceholders(taskIdBatch.length)}) AND completed_date IN (${inPlaceholders(dateBatch.length)})`
                )
                .bind(...taskIdBatch, ...dateBatch)
                .all<any>();
            processRows(results);
        }
    }

    return completionMap;
}

// 複数タスクの除外日を一括取得（D1対応）
async function getTaskExclusionsBatch(
    db: D1Database,
    taskIds: string[]
): Promise<Map<string, Array<{ excluded_date: Date; exclusion_type: string }>>> {
    if (taskIds.length === 0) return new Map();

    const exclusionsMap = new Map<string, Array<{ excluded_date: Date; exclusion_type: string }>>();

    // D1のバインドパラメータ上限(100)を超えないようにバッチ分割
    const BATCH_SIZE = 50;
    for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
        const batch = taskIds.slice(i, i + BATCH_SIZE);
        const { results } = await db
            .prepare(
                `SELECT task_id, excluded_date, exclusion_type FROM task_exclusions WHERE task_id IN (${inPlaceholders(batch.length)})`
            )
            .bind(...batch)
            .all<any>();

        for (const row of results) {
            if (!exclusionsMap.has(row.task_id)) exclusionsMap.set(row.task_id, []);
            exclusionsMap.get(row.task_id)!.push({
                excluded_date: new Date(row.excluded_date),
                exclusion_type: row.exclusion_type,
            });
        }
    }

    return exclusionsMap;
}

// 指定日付から引継ぎ完了で移動されたタスクIDを取得
// （carryover_from_date = targetDateStr のレコードがあるタスク → 元の日付から消す）
async function getCarryoverAwayTaskIds(
    db: D1Database,
    taskIds: string[],
    targetDateStr: string
): Promise<Set<string>> {
    const resultSet = new Set<string>();
    if (taskIds.length === 0) return resultSet;

    const uniqueTaskIds = [...new Set(taskIds)];
    const BATCH_SIZE = 50;

    for (let i = 0; i < uniqueTaskIds.length; i += BATCH_SIZE) {
        const batch = uniqueTaskIds.slice(i, i + BATCH_SIZE);
        const { results } = await db
            .prepare(
                `SELECT task_id FROM task_completions
                 WHERE task_id IN (${inPlaceholders(batch.length)})
                 AND carryover_from_date = ?
                 AND completed = 1`
            )
            .bind(...batch, targetDateStr)
            .all<any>();

        for (const row of results) {
            // 単発タスク用: task_id のみ
            resultSet.add(row.task_id);
            // 繰り返しタスク用: task_id + 元の日付
            resultSet.add(`${row.task_id}_${targetDateStr}`);
        }
    }

    return resultSet;
}

// carryover_from_date付きの完了レコードを一括取得（日付を問わず検索）
async function getCarryoverCompletionsBatch(
    db: D1Database,
    taskIds: string[]
): Promise<Map<string, { completed: boolean; completed_date: string }>> {
    const resultMap = new Map<string, { completed: boolean; completed_date: string }>();
    if (taskIds.length === 0) return resultMap;

    const uniqueTaskIds = [...new Set(taskIds)];
    const BATCH_SIZE = 50;

    for (let i = 0; i < uniqueTaskIds.length; i += BATCH_SIZE) {
        const batch = uniqueTaskIds.slice(i, i + BATCH_SIZE);
        const { results } = await db
            .prepare(
                `SELECT task_id, completed, completed_date, carryover_from_date FROM task_completions
                 WHERE task_id IN (${inPlaceholders(batch.length)})
                 AND carryover_from_date IS NOT NULL`
            )
            .bind(...batch)
            .all<any>();

        for (const row of results) {
            // キーは task_id + carryover_from_date（元の日付）
            const key = `${row.task_id}_${row.carryover_from_date}`;
            resultMap.set(key, {
                completed: row.completed === 1,
                completed_date: row.completed_date,
            });
        }
    }

    return resultMap;
}

// targetDate に引継ぎ完了された task_id + carryover_from_date を返す（getTasksForDateUnified用）
async function getPastCarryoverCompletedForDate(
    db: D1Database,
    userId: string,
    targetDateStr: string
): Promise<Array<{ task_id: string; carryover_from_date: string }>> {
    const { results } = await db
        .prepare(
            `SELECT tc.task_id, tc.carryover_from_date
             FROM task_completions tc
             JOIN tasks t ON tc.task_id = t.id
             WHERE t.user_id = ?
             AND tc.completed_date = ?
             AND tc.carryover_from_date IS NOT NULL
             AND tc.completed = 1
             LIMIT 50`
        )
        .bind(userId, targetDateStr)
        .all<any>();
    return results.map((r: any) => ({
        task_id: r.task_id,
        carryover_from_date: r.carryover_from_date,
    }));
}

// ソート関数
function sortDisplayTasks(tasks: DisplayTask[]): DisplayTask[] {
    return tasks.sort((a, b) => {
        const aHasTime = hasTimeInTitle(a.title);
        const bHasTime = hasTimeInTitle(b.title);
        if (aHasTime && !bHasTime) return -1;
        if (!aHasTime && bHasTime) return 1;
        if (aHasTime && bHasTime) {
            const aTime = extractTimeInMinutes(a.title);
            const bTime = extractTimeInMinutes(b.title);
            if (aTime !== null && bTime !== null) return aTime - bTime;
            return (a.created_at?.getTime() || 0) - (b.created_at?.getTime() || 0);
        }
        if (a.is_recurring && !b.is_recurring) return -1;
        if (!a.is_recurring && b.is_recurring) return 1;
        return (a.created_at?.getTime() || 0) - (b.created_at?.getTime() || 0);
    });
}
