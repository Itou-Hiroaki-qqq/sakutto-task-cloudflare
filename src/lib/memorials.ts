import { getDB } from './db';
import { DisplayMemorial } from '@/types/database';
import { format, isSameDay, getDay, endOfMonth } from 'date-fns';

// weekdays: D1ではTEXT(JSON)で保存。読み取り時にパース
function parseWeekdays(raw: string | null | undefined): number[] | null {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// 指定した日の記念日を取得（繰り返し設定を展開して表示用の記念日リストを作成）
export async function getMemorialsForDate(
    userId: string,
    targetDate: Date
): Promise<DisplayMemorial[]> {
    const db = await getDB();
    const dateStr = format(targetDate, 'yyyy-MM-dd');

    const { results: memorials } = await db
        .prepare(`
            SELECT
                m.id, m.user_id, m.title, m.due_date, m.is_holiday, m.created_at,
                mr.type as recurrence_type, mr.custom_days, mr.custom_unit,
                mr.weekdays as recurrence_weekdays
            FROM memorials m
            LEFT JOIN memorial_recurrences mr ON m.id = mr.memorial_id
            WHERE m.user_id = ?
            ORDER BY m.created_at ASC
        `)
        .bind(userId)
        .all<any>();

    const displayMemorials: DisplayMemorial[] = [];

    for (const memorial of memorials) {
        const memorialDueDate = new Date(memorial.due_date);
        memorialDueDate.setHours(0, 0, 0, 0);

        if (!memorial.recurrence_type) {
            if (isSameDay(memorialDueDate, targetDate)) {
                displayMemorials.push({
                    id: `single-${memorial.id}`,
                    memorial_id: memorial.id,
                    title: memorial.title,
                    date: targetDate,
                    due_date: memorialDueDate,
                    is_recurring: false,
                    created_at: new Date(memorial.created_at),
                });
            }
        } else {
            const weekdays = parseWeekdays(memorial.recurrence_weekdays);
            const shouldInclude = shouldIncludeRecurringMemorial(
                memorial.recurrence_type,
                memorialDueDate,
                targetDate,
                memorial.custom_days ?? null,
                memorial.custom_unit ?? null,
                weekdays
            );

            if (shouldInclude) {
                displayMemorials.push({
                    id: `recurring-${memorial.id}-${dateStr}`,
                    memorial_id: memorial.id,
                    title: memorial.title,
                    date: targetDate,
                    due_date: memorialDueDate,
                    is_recurring: true,
                    created_at: new Date(memorial.created_at),
                });
            }
        }
    }

    return displayMemorials;
}

// 繰り返し記念日が指定日に該当するかチェック（純粋関数）
export function shouldIncludeRecurringMemorial(
    recurrenceType: string,
    memorialDueDate: Date,
    targetDate: Date,
    customDays: number | null,
    customUnit: string | null,
    recurrenceWeekdays: number[] | null
): boolean {
    if (targetDate < memorialDueDate) return false;
    if (isSameDay(memorialDueDate, targetDate)) return true;

    switch (recurrenceType) {
        case 'daily':
            return true;

        case 'weekly':
            return getDay(memorialDueDate) === getDay(targetDate);

        case 'monthly':
            return memorialDueDate.getDate() === targetDate.getDate();

        case 'monthly_end':
            return isSameDay(targetDate, endOfMonth(targetDate));

        case 'yearly':
            return (
                memorialDueDate.getMonth() === targetDate.getMonth() &&
                memorialDueDate.getDate() === targetDate.getDate()
            );

        case 'weekdays':
            if (!recurrenceWeekdays || recurrenceWeekdays.length === 0) return false;
            return recurrenceWeekdays.includes(getDay(targetDate));

        case 'custom':
            if (!customDays || customDays <= 0) return false;
            if (!customUnit || customUnit === 'days') {
                const daysDiff = Math.floor(
                    (targetDate.getTime() - memorialDueDate.getTime()) / 86400000
                );
                return daysDiff >= 0 && daysDiff % customDays === 0;
            }
            if (customUnit === 'weeks') {
                const daysDiff = Math.floor(
                    (targetDate.getTime() - memorialDueDate.getTime()) / 86400000
                );
                return daysDiff >= 0 && daysDiff % (customDays * 7) === 0;
            }
            if (customUnit === 'months') {
                if (memorialDueDate.getDate() !== targetDate.getDate()) return false;
                const monthsDiff =
                    (targetDate.getFullYear() - memorialDueDate.getFullYear()) * 12 +
                    (targetDate.getMonth() - memorialDueDate.getMonth());
                return monthsDiff >= 0 && monthsDiff % customDays === 0;
            }
            if (customUnit === 'months_end') {
                if (!isSameDay(targetDate, endOfMonth(targetDate))) return false;
                const monthsDiff =
                    (targetDate.getFullYear() - memorialDueDate.getFullYear()) * 12 +
                    (targetDate.getMonth() - memorialDueDate.getMonth());
                return monthsDiff >= 0 && monthsDiff % customDays === 0;
            }
            if (customUnit === 'years') {
                if (
                    memorialDueDate.getMonth() !== targetDate.getMonth() ||
                    memorialDueDate.getDate() !== targetDate.getDate()
                ) return false;
                const yearsDiff = targetDate.getFullYear() - memorialDueDate.getFullYear();
                return yearsDiff >= 0 && yearsDiff % customDays === 0;
            }
            return false;

        default:
            return false;
    }
}

// すべての記念日を取得（リスト表示用）
export async function getAllMemorials(userId: string) {
    const db = await getDB();

    const { results } = await db
        .prepare(`
            SELECT
                m.id, m.title, m.due_date, m.is_holiday, m.created_at,
                mr.type as recurrence_type
            FROM memorials m
            LEFT JOIN memorial_recurrences mr ON m.id = mr.memorial_id
            WHERE m.user_id = ?
            ORDER BY m.due_date ASC, m.created_at ASC
        `)
        .bind(userId)
        .all<any>();

    return results.map((m: any) => ({
        id: m.id,
        title: m.title,
        due_date: new Date(m.due_date),
        is_holiday: m.is_holiday === 1,
        recurrence_type: m.recurrence_type || null,
        created_at: new Date(m.created_at),
    }));
}
