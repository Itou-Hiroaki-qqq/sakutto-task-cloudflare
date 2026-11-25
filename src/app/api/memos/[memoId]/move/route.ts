import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';
import { isValidDateStr } from '@/lib/memos';

// メモを指定日のタスクに移動する（タスク作成とメモ削除を1トランザクションで行う）
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ memoId: string }> }
) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { memoId } = await params;
        const body = await request.json() as any;
        if (!isValidDateStr(body.dueDate)) {
            return NextResponse.json({ error: 'Invalid dueDate' }, { status: 400 });
        }

        const db = await getDB();
        const memo = await db
            .prepare('SELECT content FROM memos WHERE id = ? AND user_id = ?')
            .bind(memoId, payload.uid)
            .first<{ content: string }>();
        if (!memo) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const taskId = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.batch([
            db.prepare('INSERT INTO tasks (id, user_id, title, due_date, notification_enabled, notification_time, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)')
                .bind(taskId, payload.uid, memo.content, body.dueDate, now, now),
            db.prepare('DELETE FROM memos WHERE id = ? AND user_id = ?')
                .bind(memoId, payload.uid),
        ]);

        return NextResponse.json({ success: true, taskId });
    } catch (error) {
        console.error('Error moving memo to task:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
