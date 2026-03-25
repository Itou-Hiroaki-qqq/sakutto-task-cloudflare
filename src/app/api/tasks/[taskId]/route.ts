import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';
import { parseISO } from 'date-fns';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { taskId } = await params;
        const db = await getDB();

        const task = await db
            .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? LIMIT 1')
            .bind(taskId, payload.uid)
            .first<any>();

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const recurrence = await db
            .prepare('SELECT * FROM task_recurrences WHERE task_id = ? LIMIT 1')
            .bind(taskId)
            .first<any>();

        // 完了情報を取得（dateパラメータがある場合）
        const dateParam = request.nextUrl.searchParams.get('date');
        const carryoverParam = request.nextUrl.searchParams.get('carryover');
        let completion = null;
        if (dateParam) {
            // まず通常の完了レコードを検索
            let completionRow = await db
                .prepare('SELECT completed, completed_date, carryover_from_date, updated_at FROM task_completions WHERE task_id = ? AND completed_date = ? LIMIT 1')
                .bind(taskId, dateParam)
                .first<any>();

            // 引継ぎタスクの場合、carryover_from_date で完了レコードを検索
            if (!completionRow && carryoverParam === 'true') {
                completionRow = await db
                    .prepare('SELECT completed, completed_date, carryover_from_date, updated_at FROM task_completions WHERE task_id = ? AND carryover_from_date = ? AND completed = 1 LIMIT 1')
                    .bind(taskId, dateParam)
                    .first<any>();
            }

            if (completionRow && completionRow.completed === 1) {
                completion = {
                    completed: true,
                    completed_date: completionRow.completed_date,
                    carryover_from_date: completionRow.carryover_from_date || null,
                    updated_at: completionRow.updated_at,
                };
            }
        }

        return NextResponse.json({
            task: {
                id: task.id,
                title: task.title,
                due_date: task.due_date,
                notification_enabled: task.notification_enabled === 1,
                notification_time: task.notification_time,
            },
            recurrence: recurrence
                ? {
                      type: recurrence.type,
                      custom_days: recurrence.custom_days,
                      custom_unit: recurrence.custom_unit,
                      weekdays: recurrence.weekdays ? (() => { try { return JSON.parse(recurrence.weekdays); } catch { return null; } })() : null,
                  }
                : null,
            completion,
        });
    } catch (error) {
        console.error('Error fetching task:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { taskId } = await params;
        const body = await request.json().catch(() => ({})) as any;
        const { deleteOption, targetDate } = body;

        const db = await getDB();

        const task = await db
            .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? LIMIT 1')
            .bind(taskId, payload.uid)
            .first<any>();

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const recurrence = await db
            .prepare('SELECT id FROM task_recurrences WHERE task_id = ? LIMIT 1')
            .bind(taskId)
            .first<any>();

        if (!recurrence) {
            // 単発タスクを完全に削除
            await db.prepare('DELETE FROM task_completions WHERE task_id = ?').bind(taskId).run();
            await db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(taskId, payload.uid).run();
            return NextResponse.json({ success: true, message: 'タスクを削除しました' });
        }

        if (!deleteOption || !targetDate) {
            return NextResponse.json({ error: 'deleteOption and targetDate are required for recurring tasks' }, { status: 400 });
        }

        if (deleteOption === 'this_only') {
            await db
                .prepare('DELETE FROM task_exclusions WHERE task_id = ? AND excluded_date = ? AND exclusion_type = ?')
                .bind(taskId, targetDate, 'single')
                .run();

            const exId = crypto.randomUUID();
            await db
                .prepare('INSERT OR IGNORE INTO task_exclusions (id, task_id, excluded_date, exclusion_type) VALUES (?, ?, ?, ?)')
                .bind(exId, taskId, targetDate, 'single')
                .run();

            return NextResponse.json({ success: true, message: 'このタスクを削除しました' });
        } else if (deleteOption === 'future_all') {
            await db
                .prepare('DELETE FROM task_exclusions WHERE task_id = ? AND exclusion_type = ?')
                .bind(taskId, 'after')
                .run();

            const exId = crypto.randomUUID();
            await db
                .prepare('INSERT OR IGNORE INTO task_exclusions (id, task_id, excluded_date, exclusion_type) VALUES (?, ?, ?, ?)')
                .bind(exId, taskId, targetDate, 'after')
                .run();

            return NextResponse.json({ success: true, message: 'これ以降の繰り返しタスクをすべて削除しました' });
        } else {
            return NextResponse.json({ error: 'Invalid deleteOption' }, { status: 400 });
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
