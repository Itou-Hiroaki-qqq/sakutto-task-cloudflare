import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';
import { format, endOfMonth, isSameDay } from 'date-fns';

export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q');

        if (!query || query.trim() === '') {
            return NextResponse.json({ results: [] });
        }

        const db = await getDB();

        // D1はILIKEをサポートしていないのでLIKEを使用（SQLiteはcase-insensitive for ASCII）
        const { results: tasks } = await db
            .prepare(`
                SELECT
                    t.id, t.title, t.due_date,
                    tr.type as recurrence_type, tr.custom_days, tr.custom_unit,
                    tr.weekdays as recurrence_weekdays
                FROM tasks t
                LEFT JOIN task_recurrences tr ON t.id = tr.task_id
                WHERE t.user_id = ?
                AND t.title LIKE ?
                ORDER BY t.due_date ASC
            `)
            .bind(payload.uid, `%${query}%`)
            .all<any>();

        const results: { date: string; taskId: string; title: string }[] = [];

        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 20);
        endDate.setHours(23, 59, 59, 999);

        for (const task of tasks) {
            const dueDate = new Date(task.due_date);
            dueDate.setHours(0, 0, 0, 0);

            if (!task.recurrence_type) {
                if (dueDate >= startDate && dueDate <= endDate) {
                    results.push({
                        date: format(dueDate, 'yyyy-MM-dd'),
                        taskId: task.id,
                        title: task.title,
                    });
                }
            } else {
                // 除外日を取得
                const { results: exclusionRows } = await db
                    .prepare('SELECT excluded_date, exclusion_type FROM task_exclusions WHERE task_id = ?')
                    .bind(task.id)
                    .all<any>();

                const excludedDates = new Set<string>();
                let afterDate: Date | null = null;
                for (const ex of exclusionRows) {
                    if (ex.exclusion_type === 'single') {
                        excludedDates.add(ex.excluded_date);
                    } else if (ex.exclusion_type === 'after') {
                        afterDate = new Date(ex.excluded_date);
                    }
                }

                const weekdays = task.recurrence_weekdays
                    ? (() => { try { return JSON.parse(task.recurrence_weekdays); } catch { return null; } })()
                    : null;

                const recurringDates = getRecurringDates(
                    dueDate, startDate, endDate,
                    task.recurrence_type, task.custom_days, task.custom_unit, weekdays,
                    excludedDates, afterDate
                );

                for (const date of recurringDates) {
                    results.push({
                        date: format(date, 'yyyy-MM-dd'),
                        taskId: task.id,
                        title: task.title,
                    });
                }
            }
        }

        results.sort((a, b) => {
            const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
            if (dateCompare !== 0) return dateCompare;
            return a.title.localeCompare(b.title);
        });

        return NextResponse.json({ results });
    } catch (error) {
        console.error('Error searching tasks:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

function getRecurringDates(
    startDate: Date,
    fromDate: Date,
    toDate: Date,
    recurrenceType: string,
    customDays: number | null,
    customUnit: string | null,
    weekdays: number[] | null,
    excludedDates: Set<string>,
    afterDate: Date | null
): Date[] {
    const dates: Date[] = [];
    const current = new Date(Math.max(startDate.getTime(), fromDate.getTime()));
    current.setHours(0, 0, 0, 0);

    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);

    while (current <= end) {
        const currentDateStr = format(current, 'yyyy-MM-dd');

        if (excludedDates.has(currentDateStr)) {
            current.setDate(current.getDate() + 1);
            continue;
        }
        if (afterDate && current >= afterDate) {
            current.setDate(current.getDate() + 1);
            continue;
        }

        let shouldInclude = false;

        switch (recurrenceType) {
            case 'daily':
                shouldInclude = true;
                break;
            case 'weekly':
                shouldInclude = current.getDay() === startDate.getDay();
                break;
            case 'monthly':
                shouldInclude = current.getDate() === startDate.getDate();
                break;
            case 'monthly_end':
                shouldInclude = isSameDay(current, endOfMonth(current));
                break;
            case 'yearly':
                shouldInclude =
                    current.getMonth() === startDate.getMonth() &&
                    current.getDate() === startDate.getDate();
                break;
            case 'weekdays':
                if (weekdays && weekdays.length > 0) {
                    shouldInclude = weekdays.includes(current.getDay());
                }
                break;
            case 'custom':
                if (!customDays || customDays <= 0) break;
                if (!customUnit || customUnit === 'days') {
                    const daysDiff = Math.floor((current.getTime() - startDate.getTime()) / 86400000);
                    shouldInclude = daysDiff >= 0 && daysDiff % customDays === 0;
                } else if (customUnit === 'weeks') {
                    const daysDiff = Math.floor((current.getTime() - startDate.getTime()) / 86400000);
                    shouldInclude = daysDiff >= 0 && daysDiff % (customDays * 7) === 0;
                } else if (customUnit === 'months') {
                    if (current.getDate() !== startDate.getDate()) {
                        shouldInclude = false;
                    } else {
                        const monthsDiff = (current.getFullYear() - startDate.getFullYear()) * 12 +
                            (current.getMonth() - startDate.getMonth());
                        shouldInclude = monthsDiff >= 0 && monthsDiff % customDays === 0;
                    }
                } else if (customUnit === 'months_end') {
                    if (!isSameDay(current, endOfMonth(current))) {
                        shouldInclude = false;
                    } else {
                        const monthsDiff = (current.getFullYear() - startDate.getFullYear()) * 12 +
                            (current.getMonth() - startDate.getMonth());
                        shouldInclude = monthsDiff >= 0 && monthsDiff % customDays === 0;
                    }
                } else if (customUnit === 'years') {
                    if (current.getMonth() !== startDate.getMonth() ||
                        current.getDate() !== startDate.getDate()) {
                        shouldInclude = false;
                    } else {
                        const yearsDiff = current.getFullYear() - startDate.getFullYear();
                        shouldInclude = yearsDiff >= 0 && yearsDiff % customDays === 0;
                    }
                }
                break;
        }

        if (shouldInclude) {
            dates.push(new Date(current));
        }

        current.setDate(current.getDate() + 1);
    }

    return dates;
}
