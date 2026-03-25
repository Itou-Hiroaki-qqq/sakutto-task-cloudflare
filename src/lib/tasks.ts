import { getDB } from './db';
import { TaskCompletion, DisplayTask } from '@/types/database';
import {
    format, isSameDay, addDays, addMonths, addYears, getDay,
    endOfMonth, isBefore, startOfDay, parseISO,
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

// 未完了の過去タスクを引継ぎタスクとして取得（過去30日・最大50件）
export async function getCarryoverTasks(userId: string, todayJST: Date): Promise<DisplayTask[]> {
    const db = await getDB();
    const todayStart = startOfDay(todayJST);
    const thirtyDaysAgo = addDays(todayStart, -30);

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

    // タスクと元の出現日のペアを収集
    const carryoverPairs: Array<{ task: any; originalDate: Date }> = [];
    const recurringTaskIds = tasks.filter(t => t.recurrence_type).map(t => t.id);
    const exclusionsMap = await getTaskExclusionsBatch(db, recurringTaskIds);

    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);

        if (!task.recurrence_type) {
            // 単発タスク: 30日以内の過去 due_date のもの
            if (isBefore(taskDueDate, todayStart) && !isBefore(taskDueDate, thirtyDaysAgo)) {
                carryoverPairs.push({ task, originalDate: taskDueDate });
            }
        } else {
            // 繰り返しタスク: thirtyDaysAgo から todayStart の間の出現日を取得
            if (isBefore(taskDueDate, todayStart)) {
                const exclusions = exclusionsMap.get(task.id) || null;

                // 'after' 除外が taskDueDate より前にある場合はスキップ
                let excludeAfterDate: Date | null = null;
                if (exclusions) {
                    for (const ex of exclusions) {
                        if (ex.exclusion_type === 'after' && ex.excluded_date < todayStart) {
                            excludeAfterDate = ex.excluded_date;
                            break;
                        }
                    }
                }
                if (excludeAfterDate && isBefore(excludeAfterDate, taskDueDate)) continue;

                const weekdays = parseWeekdays(task.recurrence_weekdays);
                // taskDueDate を起点に todayStart(exclusive)までの出現日を計算し、thirtyDaysAgo 以降のものだけ採用
                const occurrenceDates = getRecurringOccurrenceDates(
                    task.recurrence_type, taskDueDate, todayStart,
                    task.custom_days, task.custom_unit, weekdays, exclusions
                );
                for (const occurrenceDate of occurrenceDates) {
                    // 30日以内の出現日のみ
                    if (!isBefore(occurrenceDate, thirtyDaysAgo)) {
                        carryoverPairs.push({ task, originalDate: occurrenceDate });
                    }
                }
            }
        }
    }

    // 完了状態を一括取得（元の日付ベース）
    const completionPairs = carryoverPairs.map(p => ({ taskId: p.task.id, date: p.originalDate }));
    const completionsMap = await getTaskCompletionsBatch(db, completionPairs);

    // 今日の日付で carryover_from_date 付きの完了レコードを一括取得
    const todayStr = format(todayJST, 'yyyy-MM-dd');
    const carryoverCompletionsMap = await getCarryoverCompletionsBatch(db, carryoverPairs.map(p => p.task.id), todayStr);

    // 未完了 + 今日完了した引継ぎタスクを DisplayTask に変換
    const carryoverTasks: DisplayTask[] = [];
    for (const { task, originalDate } of carryoverPairs) {
        const originalDateStr = format(originalDate, 'yyyy-MM-dd');
        const key = `${task.id}_${originalDateStr}`;
        const completionOnOriginal = completionsMap.get(key);

        // 元の日付で完了済み（通常完了）→ 引継ぎ対象外
        if (completionOnOriginal?.completed) continue;

        // 今日のcarryover完了をチェック
        const carryoverCompletion = carryoverCompletionsMap.get(`${task.id}_${originalDateStr}`);
        const isCompletedAsCarryover = !!carryoverCompletion?.completed;

        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
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

    // original_date の古い順にソートして上限50件で切り捨て
    return carryoverTasks
        .sort((a, b) => (a.original_date!.getTime()) - (b.original_date!.getTime()))
        .slice(0, 50);
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

    // 引継ぎタスクの場合、元の日付の完了レコードがあれば削除（二重記録防止）
    if (carryoverFromDate && carryoverFromDate !== dateStr) {
        await db
            .prepare('DELETE FROM task_completions WHERE task_id = ? AND completed_date = ?')
            .bind(taskId, carryoverFromDate)
            .run();
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

// 繰り返しタスクの出現日を計算
function getRecurringOccurrenceDates(
    recurrenceType: string,
    taskDueDate: Date,
    endDate: Date,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null,
    exclusions: Array<{ excluded_date: Date; exclusion_type: string }> | null
): Date[] {
    const occurrences: Date[] = [];
    let checkDate = new Date(taskDueDate);
    const maxDays = 365;

    const isExcluded = (date: Date): boolean => {
        if (!exclusions) return false;
        for (const ex of exclusions) {
            if (ex.exclusion_type === 'single' && isSameDay(ex.excluded_date, date)) return true;
            if (ex.exclusion_type === 'after' && date >= ex.excluded_date) return true;
        }
        return false;
    };

    switch (recurrenceType) {
        case 'daily':
            while (isBefore(checkDate, endDate)) {
                if (!isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                checkDate = addDays(checkDate, 1);
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
            }
            break;
        case 'weekly': {
            const targetWeekday = getDay(taskDueDate);
            while (isBefore(checkDate, endDate)) {
                if (getDay(checkDate) === targetWeekday && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                const daysUntil = (targetWeekday - getDay(checkDate) + 7) % 7 || 7;
                checkDate = addDays(checkDate, daysUntil);
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
            }
            break;
        }
        case 'monthly': {
            const targetDay = taskDueDate.getDate();
            while (isBefore(checkDate, endDate)) {
                if (checkDate.getDate() === targetDay && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                checkDate = addMonths(checkDate, 1);
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
            }
            break;
        }
        case 'monthly_end':
            while (isBefore(checkDate, endDate)) {
                if (isSameDay(checkDate, endOfMonth(checkDate)) && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                checkDate = addMonths(checkDate, 1);
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
            }
            break;
        case 'yearly': {
            const targetMonth = taskDueDate.getMonth();
            const targetDate = taskDueDate.getDate();
            while (isBefore(checkDate, endDate)) {
                if (checkDate.getMonth() === targetMonth && checkDate.getDate() === targetDate && !isExcluded(checkDate))
                    occurrences.push(new Date(checkDate));
                checkDate = addYears(checkDate, 1);
                if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
            }
            break;
        }
        case 'weekdays':
            if (weekdays && weekdays.length > 0) {
                const weekdaySet = new Set(weekdays);
                while (isBefore(checkDate, endDate)) {
                    if (weekdaySet.has(getDay(checkDate)) && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                    checkDate = addDays(checkDate, 1);
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
                }
            }
            break;
        case 'custom':
            if (!customDays || customDays <= 0) break;
            if (!customUnit || customUnit === 'days') {
                while (isBefore(checkDate, endDate)) {
                    const diff = Math.floor((checkDate.getTime() - taskDueDate.getTime()) / 86400000);
                    if (diff >= 0 && diff % customDays === 0 && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                    checkDate = addDays(checkDate, customDays);
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
                }
            } else if (customUnit === 'weeks') {
                while (isBefore(checkDate, endDate)) {
                    const diff = Math.floor((checkDate.getTime() - taskDueDate.getTime()) / 86400000);
                    if (diff >= 0 && diff % (customDays * 7) === 0 && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                    checkDate = addDays(checkDate, customDays * 7);
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
                }
            } else if (customUnit === 'months') {
                while (isBefore(checkDate, endDate)) {
                    if (checkDate.getDate() === taskDueDate.getDate()) {
                        const monthsDiff = (checkDate.getFullYear() - taskDueDate.getFullYear()) * 12 +
                            (checkDate.getMonth() - taskDueDate.getMonth());
                        if (monthsDiff >= 0 && monthsDiff % customDays === 0 && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                    }
                    checkDate = addMonths(checkDate, customDays);
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
                }
            } else if (customUnit === 'months_end') {
                while (isBefore(checkDate, endDate)) {
                    if (isSameDay(checkDate, endOfMonth(checkDate))) {
                        const monthsDiff = (checkDate.getFullYear() - taskDueDate.getFullYear()) * 12 +
                            (checkDate.getMonth() - taskDueDate.getMonth());
                        if (monthsDiff >= 0 && monthsDiff % customDays === 0 && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                    }
                    checkDate = addMonths(checkDate, customDays);
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
                }
            } else if (customUnit === 'years') {
                while (isBefore(checkDate, endDate)) {
                    if (checkDate.getMonth() === taskDueDate.getMonth() && checkDate.getDate() === taskDueDate.getDate()) {
                        const yearsDiff = checkDate.getFullYear() - taskDueDate.getFullYear();
                        if (yearsDiff >= 0 && yearsDiff % customDays === 0 && !isExcluded(checkDate)) occurrences.push(new Date(checkDate));
                    }
                    checkDate = addYears(checkDate, customDays);
                    if (Math.abs((checkDate.getTime() - taskDueDate.getTime()) / 86400000) > maxDays) break;
                }
            }
            break;
    }

    return occurrences;
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

// 今日の日付でcarryover_from_date付きの完了レコードを一括取得
async function getCarryoverCompletionsBatch(
    db: D1Database,
    taskIds: string[],
    todayStr: string
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
                 AND completed_date = ?
                 AND carryover_from_date IS NOT NULL`
            )
            .bind(...batch, todayStr)
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
