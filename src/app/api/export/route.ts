import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';
import { format } from 'date-fns';

export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const db = await getDB();
        const userId = payload.uid;

        const { results: tasks } = await db
            .prepare('SELECT id, title, due_date, notification_time, notification_enabled, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at ASC')
            .bind(userId)
            .all<any>();

        const { results: taskRecurrences } = await db
            .prepare('SELECT tr.task_id, tr.type, tr.custom_days, tr.custom_unit, tr.weekdays FROM task_recurrences tr INNER JOIN tasks t ON tr.task_id = t.id WHERE t.user_id = ?')
            .bind(userId)
            .all<any>();

        const { results: taskExclusions } = await db
            .prepare('SELECT te.task_id, te.excluded_date, te.exclusion_type FROM task_exclusions te INNER JOIN tasks t ON te.task_id = t.id WHERE t.user_id = ?')
            .bind(userId)
            .all<any>();

        const { results: taskCompletions } = await db
            .prepare('SELECT tc.task_id, tc.completed_date, tc.completed FROM task_completions tc INNER JOIN tasks t ON tc.task_id = t.id WHERE t.user_id = ? AND tc.completed = 1')
            .bind(userId)
            .all<any>();

        const { results: memorials } = await db
            .prepare('SELECT id, title, due_date, notification_time, notification_enabled, created_at, updated_at FROM memorials WHERE user_id = ? ORDER BY created_at ASC')
            .bind(userId)
            .all<any>();

        const { results: memorialRecurrences } = await db
            .prepare('SELECT mr.memorial_id, mr.type, mr.custom_days, mr.custom_unit, mr.weekdays FROM memorial_recurrences mr INNER JOIN memorials m ON mr.memorial_id = m.id WHERE m.user_id = ?')
            .bind(userId)
            .all<any>();

        const formatDate = (date: any): string => {
            if (!date) return '';
            if (typeof date === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
                if (date.includes('T')) return date.split('T')[0];
                return date;
            }
            if (date instanceof Date) return format(date, 'yyyy-MM-dd');
            return String(date);
        };

        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            tasks: tasks.map((task: any) => {
                const recurrence = taskRecurrences.find((r: any) => r.task_id === task.id);
                return {
                    id: task.id,
                    title: task.title,
                    due_date: formatDate(task.due_date),
                    notification_time: task.notification_time,
                    notification_enabled: task.notification_enabled === 1,
                    created_at: task.created_at,
                    updated_at: task.updated_at,
                    recurrence: recurrence ? {
                        type: recurrence.type,
                        custom_days: recurrence.custom_days,
                        custom_unit: recurrence.custom_unit,
                        weekdays: recurrence.weekdays ? (() => { try { return JSON.parse(recurrence.weekdays); } catch { return null; } })() : null,
                    } : null,
                    exclusions: taskExclusions
                        .filter((e: any) => e.task_id === task.id)
                        .map((e: any) => ({
                            excluded_date: formatDate(e.excluded_date),
                            exclusion_type: e.exclusion_type,
                        })),
                    completions: taskCompletions
                        .filter((c: any) => c.task_id === task.id)
                        .map((c: any) => ({
                            completed_date: formatDate(c.completed_date),
                        })),
                };
            }),
            memorials: memorials.map((memorial: any) => {
                const recurrence = memorialRecurrences.find((r: any) => r.memorial_id === memorial.id);
                return {
                    id: memorial.id,
                    title: memorial.title,
                    due_date: formatDate(memorial.due_date),
                    notification_time: memorial.notification_time,
                    notification_enabled: memorial.notification_enabled === 1,
                    created_at: memorial.created_at,
                    updated_at: memorial.updated_at,
                    recurrence: recurrence ? {
                        type: recurrence.type,
                        custom_days: recurrence.custom_days,
                        custom_unit: recurrence.custom_unit,
                        weekdays: recurrence.weekdays ? (() => { try { return JSON.parse(recurrence.weekdays); } catch { return null; } })() : null,
                    } : null,
                };
            }),
        };

        return NextResponse.json(exportData, {
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="sakutto-task-backup-${new Date().toISOString().split('T')[0]}.json"`,
            },
        });
    } catch (error) {
        console.error('Export error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Export failed' }, { status: 500 });
    }
}
