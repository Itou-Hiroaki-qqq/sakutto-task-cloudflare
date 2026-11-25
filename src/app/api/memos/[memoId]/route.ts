import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';
import { normalizeMemoContent } from '@/lib/memos';

export async function PUT(
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
        const content = normalizeMemoContent(body.content);
        if (!content) {
            return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
        }

        const db = await getDB();
        await db
            .prepare('UPDATE memos SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?')
            .bind(content, new Date().toISOString(), memoId, payload.uid)
            .run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating memo:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ memoId: string }> }
) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { memoId } = await params;
        const db = await getDB();
        await db
            .prepare('DELETE FROM memos WHERE id = ? AND user_id = ?')
            .bind(memoId, payload.uid)
            .run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting memo:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
