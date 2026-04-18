import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import {
    getTasksBasicForDate,
    getTasksForDateUnified,
    updateTasksWithCompletionStatus,
} from '@/lib/tasks';
import { getTodayJST } from '@/lib/timezone';
import { getDB } from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const dateStr = searchParams.get('date');
        const basic = searchParams.get('basic') === 'true';

        if (!dateStr) {
            return NextResponse.json({ error: 'Date parameter is required' }, { status: 400 });
        }

        const date = new Date(dateStr);
        const tasks = basic
            ? await getTasksBasicForDate(payload.uid, date)
            : await getTasksForDateUnified(payload.uid, date, getTodayJST());

        return NextResponse.json({ tasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// 完了状態のみを更新（段階的読み込み用）
export async function PATCH(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as any;
        const { tasks, date } = body;

        if (!tasks || !Array.isArray(tasks) || !date) {
            return NextResponse.json({ error: 'Tasks array and date are required' }, { status: 400 });
        }

        const targetDate = new Date(date);
        const updatedTasks = await updateTasksWithCompletionStatus(tasks, payload.uid, targetDate);

        return NextResponse.json({ tasks: updatedTasks });
    } catch (error) {
        console.error('Error updating completion status:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as any;
        const {
            title, dueDate, notificationEnabled, notificationTime,
            recurrenceType, customDays, customUnit, selectedWeekdays,
        } = body;

        if (!title || !dueDate) {
            return NextResponse.json({ error: 'Title and due date are required' }, { status: 400 });
        }

        const db = await getDB();
        const taskId = crypto.randomUUID();
        const now = new Date().toISOString();

        const statements: D1PreparedStatement[] = [
            db.prepare('INSERT INTO tasks (id, user_id, title, due_date, notification_enabled, notification_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(taskId, payload.uid, title, dueDate, notificationEnabled ? 1 : 0, notificationTime || null, now, now),
        ];

        if (recurrenceType) {
            const recId = crypto.randomUUID();
            statements.push(
                db.prepare('INSERT INTO task_recurrences (id, task_id, type, custom_days, custom_unit, weekdays) VALUES (?, ?, ?, ?, ?, ?)')
                    .bind(recId, taskId, recurrenceType, customDays || null, customUnit || null, selectedWeekdays ? JSON.stringify(selectedWeekdays) : null)
            );
        }

        await db.batch(statements);

        return NextResponse.json({ success: true, taskId });
    } catch (error) {
        console.error('Error creating task:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as any;
        const {
            taskId, title, dueDate, notificationEnabled, notificationTime,
            recurrenceType, customDays, customUnit, selectedWeekdays,
            updateScope, targetDate,
        } = body;

        if (!taskId || !title || !dueDate) {
            return NextResponse.json({ error: 'Task ID, title and due date are required' }, { status: 400 });
        }

        const db = await getDB();
        const now = new Date().toISOString();

        if (updateScope === 'this_only' && targetDate) {
            // 「この予定のみ変更」: 除外日を追加して新しい単発タスクを作成
            const exId = crypto.randomUUID();
            const newTaskId = crypto.randomUUID();
            await db.batch([
                db.prepare('DELETE FROM task_exclusions WHERE task_id = ? AND excluded_date = ? AND exclusion_type = ?')
                    .bind(taskId, targetDate, 'single'),
                db.prepare('INSERT OR IGNORE INTO task_exclusions (id, task_id, excluded_date, exclusion_type) VALUES (?, ?, ?, ?)')
                    .bind(exId, taskId, targetDate, 'single'),
                db.prepare('INSERT INTO tasks (id, user_id, title, due_date, notification_enabled, notification_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(newTaskId, payload.uid, title, dueDate, notificationEnabled ? 1 : 0, notificationTime || null, now, now),
            ]);

            return NextResponse.json({ success: true });
        }

        // 通常の更新（単発 or 以降すべて）
        const updateStatements: D1PreparedStatement[] = [
            db.prepare('UPDATE tasks SET title = ?, due_date = ?, notification_enabled = ?, notification_time = ?, updated_at = ? WHERE id = ? AND user_id = ?')
                .bind(title, dueDate, notificationEnabled ? 1 : 0, notificationTime || null, now, taskId, payload.uid),
            db.prepare('DELETE FROM task_recurrences WHERE task_id = ?').bind(taskId),
        ];

        if (recurrenceType) {
            const recId = crypto.randomUUID();
            updateStatements.push(
                db.prepare('INSERT INTO task_recurrences (id, task_id, type, custom_days, custom_unit, weekdays) VALUES (?, ?, ?, ?, ?, ?)')
                    .bind(recId, taskId, recurrenceType, customDays || null, customUnit || null, selectedWeekdays ? JSON.stringify(selectedWeekdays) : null)
            );
        }

        await db.batch(updateStatements);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating task:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
