import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';

interface ImportTask {
    id?: string;
    title: string;
    due_date: string;
    notification_time: string | null;
    notification_enabled: boolean;
    created_at?: string;
    updated_at?: string;
    recurrence?: {
        type: string;
        custom_days: number | null;
        custom_unit: string | null;
        weekdays: number[] | null;
    } | null;
    exclusions?: Array<{
        excluded_date: string;
        exclusion_type: string;
    }>;
    completions?: Array<{
        completed_date: string;
    }>;
}

interface ImportMemorial {
    id?: string;
    title: string;
    due_date: string;
    notification_time: string | null;
    notification_enabled: boolean;
    created_at?: string;
    updated_at?: string;
    recurrence?: {
        type: string;
        custom_days: number | null;
        custom_unit: string | null;
        weekdays: number[] | null;
    } | null;
}

interface ImportData {
    version?: string;
    exportedAt?: string;
    tasks?: ImportTask[];
    memorials?: ImportMemorial[];
}

export async function POST(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const importData = await request.json() as ImportData;

        if (!importData || (!importData.tasks && !importData.memorials)) {
            return NextResponse.json({ error: 'Invalid import data' }, { status: 400 });
        }

        const db = await getDB();
        const userId = payload.uid;
        let importedTasks = 0;
        let importedMemorials = 0;
        const errors: string[] = [];
        const now = new Date().toISOString();

        if (importData.tasks && Array.isArray(importData.tasks)) {
            for (const task of importData.tasks) {
                try {
                    if (!task.title || typeof task.title !== 'string' || !task.title.trim()) {
                        errors.push('タイトルが未入力のタスクはスキップされました');
                        continue;
                    }
                    if (!task.due_date || typeof task.due_date !== 'string' || isNaN(Date.parse(task.due_date))) {
                        errors.push(`タスク「${task.title}」: 日付が不正です`);
                        continue;
                    }
                    if (task.recurrence && task.recurrence.weekdays !== null && task.recurrence.weekdays !== undefined && !Array.isArray(task.recurrence.weekdays)) {
                        errors.push(`タスク「${task.title}」: weekdays は配列である必要があります`);
                        continue;
                    }

                    const newTaskId = crypto.randomUUID();

                    await db
                        .prepare('INSERT INTO tasks (id, user_id, title, due_date, notification_enabled, notification_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                        .bind(newTaskId, userId, task.title, task.due_date, task.notification_enabled ? 1 : 0, task.notification_time || null, task.created_at || now, task.updated_at || now)
                        .run();

                    if (task.recurrence && task.recurrence.type) {
                        const recId = crypto.randomUUID();
                        await db
                            .prepare('INSERT INTO task_recurrences (id, task_id, type, custom_days, custom_unit, weekdays) VALUES (?, ?, ?, ?, ?, ?)')
                            .bind(recId, newTaskId, task.recurrence.type, task.recurrence.custom_days || null, task.recurrence.custom_unit || null, task.recurrence.weekdays ? JSON.stringify(task.recurrence.weekdays) : null)
                            .run();
                    }

                    if (task.exclusions && Array.isArray(task.exclusions)) {
                        for (const exclusion of task.exclusions) {
                            const exId = crypto.randomUUID();
                            await db
                                .prepare('INSERT OR IGNORE INTO task_exclusions (id, task_id, excluded_date, exclusion_type) VALUES (?, ?, ?, ?)')
                                .bind(exId, newTaskId, exclusion.excluded_date, exclusion.exclusion_type)
                                .run();
                        }
                    }

                    if (task.completions && Array.isArray(task.completions)) {
                        for (const completion of task.completions) {
                            const compId = crypto.randomUUID();
                            await db
                                .prepare('INSERT OR IGNORE INTO task_completions (id, task_id, completed_date, completed) VALUES (?, ?, ?, 1)')
                                .bind(compId, newTaskId, completion.completed_date)
                                .run();
                        }
                    }

                    importedTasks++;
                } catch (error) {
                    console.error('Error importing task:', error);
                    errors.push(`タスク「${task.title}」のインポートに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        }

        if (importData.memorials && Array.isArray(importData.memorials)) {
            for (const memorial of importData.memorials) {
                try {
                    if (!memorial.title || typeof memorial.title !== 'string' || !memorial.title.trim()) {
                        errors.push('タイトルが未入力の記念日はスキップされました');
                        continue;
                    }
                    if (!memorial.due_date || typeof memorial.due_date !== 'string' || isNaN(Date.parse(memorial.due_date))) {
                        errors.push(`記念日「${memorial.title}」: 日付が不正です`);
                        continue;
                    }
                    if (memorial.recurrence && memorial.recurrence.weekdays !== null && memorial.recurrence.weekdays !== undefined && !Array.isArray(memorial.recurrence.weekdays)) {
                        errors.push(`記念日「${memorial.title}」: weekdays は配列である必要があります`);
                        continue;
                    }

                    const newMemorialId = crypto.randomUUID();

                    await db
                        .prepare('INSERT INTO memorials (id, user_id, title, due_date, notification_enabled, notification_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                        .bind(newMemorialId, userId, memorial.title, memorial.due_date, memorial.notification_enabled ? 1 : 0, memorial.notification_time || null, memorial.created_at || now, memorial.updated_at || now)
                        .run();

                    if (memorial.recurrence && memorial.recurrence.type) {
                        const recId = crypto.randomUUID();
                        await db
                            .prepare('INSERT INTO memorial_recurrences (id, memorial_id, type, custom_days, custom_unit, weekdays) VALUES (?, ?, ?, ?, ?, ?)')
                            .bind(recId, newMemorialId, memorial.recurrence.type, memorial.recurrence.custom_days || null, memorial.recurrence.custom_unit || null, memorial.recurrence.weekdays ? JSON.stringify(memorial.recurrence.weekdays) : null)
                            .run();
                    }

                    importedMemorials++;
                } catch (error) {
                    console.error('Error importing memorial:', error);
                    errors.push(`記念日「${memorial.title}」のインポートに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        }

        return NextResponse.json({
            success: true,
            importedTasks,
            importedMemorials,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        console.error('Import error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Import failed' }, { status: 500 });
    }
}
