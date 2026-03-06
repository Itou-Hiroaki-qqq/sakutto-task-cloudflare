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

    // 4. 表示用タスクリストを作成
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
        const weekdays = parseWeekdays(task.recurrence_weekdays);

        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
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

// 未完了の過去タスクがある日を取得
export async function getOverdueTaskDates(userId: string, today: Date): Promise<Date[]> {
    const db = await getDB();
    const todayStart = startOfDay(today);

    const { results: tasks } = await db
        .prepare(`
            SELECT
                t.id, t.user_id, t.title, t.due_date, t.created_at,
                tr.type as recurrence_type, tr.custom_days, tr.custom_unit,
                tr.weekdays as recurrence_weekdays
            FROM tasks t
            LEFT JOIN task_recurrences tr ON t.id = tr.task_id
            WHERE t.user_id = ?
            ORDER BY t.created_at ASC
        `)
        .bind(userId)
        .all<any>();

    const overdueCompletionPairs: Array<{ taskId: string; date: Date }> = [];
    const recurringTaskIds: string[] = [];

    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
        if (isBefore(taskDueDate, todayStart)) {
            if (!task.recurrence_type) {
                overdueCompletionPairs.push({ taskId: task.id, date: taskDueDate });
            } else {
                recurringTaskIds.push(task.id);
            }
        }
    }

    const exclusionsMap = await getTaskExclusionsBatch(db, recurringTaskIds);

    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
        if (isBefore(taskDueDate, todayStart) && task.recurrence_type) {
            const exclusions = exclusionsMap.get(task.id) || null;
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
            const occurrenceDates = getRecurringOccurrenceDates(
                task.recurrence_type, taskDueDate, todayStart,
                task.custom_days, task.custom_unit, weekdays, exclusions
            );
            for (const occurrenceDate of occurrenceDates) {
                overdueCompletionPairs.push({ taskId: task.id, date: occurrenceDate });
            }
        }
    }

    const completionsMap = await getTaskCompletionsBatch(db, overdueCompletionPairs);
    const overdueDatesSet = new Set<string>();
    for (const pair of overdueCompletionPairs) {
        const key = `${pair.taskId}_${format(pair.date, 'yyyy-MM-dd')}`;
        const completion = completionsMap.get(key);
        if (!completion?.completed) {
            overdueDatesSet.add(format(pair.date, 'yyyy-MM-dd'));
        }
    }

    return Array.from(overdueDatesSet)
        .map(dateStr => parseISO(dateStr))
        .sort((a, b) => a.getTime() - b.getTime());
}

// タスクの完了状態を更新
export async function toggleTaskCompletion(
    taskId: string,
    date: Date,
    completed: boolean
): Promise<void> {
    const db = await getDB();
    const dateStr = format(date, 'yyyy-MM-dd');
    const now = new Date().toISOString();

    const existing = await db
        .prepare('SELECT id FROM task_completions WHERE task_id = ? AND completed_date = ? LIMIT 1')
        .bind(taskId, dateStr)
        .first<{ id: string }>();

    if (existing) {
        await db
            .prepare('UPDATE task_completions SET completed = ?, updated_at = ? WHERE task_id = ? AND completed_date = ?')
            .bind(completed ? 1 : 0, now, taskId, dateStr)
            .run();
    } else {
        const id = crypto.randomUUID();
        await db
            .prepare('INSERT INTO task_completions (id, task_id, completed_date, completed) VALUES (?, ?, ?, ?)')
            .bind(id, taskId, dateStr, completed ? 1 : 0)
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

    const { results } = await db
        .prepare(
            `SELECT * FROM task_completions WHERE task_id IN (${inPlaceholders(taskIds.length)}) AND completed_date IN (${inPlaceholders(dateStrs.length)})`
        )
        .bind(...taskIds, ...dateStrs)
        .all<any>();

    const pairSet = new Set(taskIdDatePairs.map(p => `${p.taskId}_${format(p.date, 'yyyy-MM-dd')}`));

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

    return completionMap;
}

// 複数タスクの除外日を一括取得（D1対応）
async function getTaskExclusionsBatch(
    db: D1Database,
    taskIds: string[]
): Promise<Map<string, Array<{ excluded_date: Date; exclusion_type: string }>>> {
    if (taskIds.length === 0) return new Map();

    const { results } = await db
        .prepare(
            `SELECT task_id, excluded_date, exclusion_type FROM task_exclusions WHERE task_id IN (${inPlaceholders(taskIds.length)})`
        )
        .bind(...taskIds)
        .all<any>();

    const exclusionsMap = new Map<string, Array<{ excluded_date: Date; exclusion_type: string }>>();
    for (const row of results) {
        if (!exclusionsMap.has(row.task_id)) exclusionsMap.set(row.task_id, []);
        exclusionsMap.get(row.task_id)!.push({
            excluded_date: new Date(row.excluded_date),
            exclusion_type: row.exclusion_type,
        });
    }

    return exclusionsMap;
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
