import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';
import {
    MEMO_MAX_COUNT,
    isValidIsoDate,
    isValidMemoId,
    normalizeMemoContent,
} from '@/lib/memos';

// 一覧取得（古い順）
export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const db = await getDB();
        const { results } = await db
            .prepare('SELECT id, content, created_at FROM memos WHERE user_id = ? ORDER BY created_at ASC, rowid ASC')
            .bind(payload.uid)
            .all<{ id: string; content: string; created_at: string }>();

        return NextResponse.json({ memos: results });
    } catch (error) {
        console.error('Error fetching memos:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// 追加（「元に戻す」では id / createdAt を指定して復元する）
export async function POST(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as any;
        const content = normalizeMemoContent(body.content);
        if (!content) {
            return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
        }

        const id = body.id === undefined ? crypto.randomUUID() : body.id;
        if (!isValidMemoId(id)) {
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
        }
        const now = new Date().toISOString();
        const createdAt = body.createdAt === undefined ? now : body.createdAt;
        if (!isValidIsoDate(createdAt)) {
            return NextResponse.json({ error: 'Invalid createdAt' }, { status: 400 });
        }

        const db = await getDB();
        const count = await db
            .prepare('SELECT COUNT(*) AS n FROM memos WHERE user_id = ?')
            .bind(payload.uid)
            .first<{ n: number }>();
        if ((count?.n ?? 0) >= MEMO_MAX_COUNT) {
            return NextResponse.json({ error: 'Too many memos' }, { status: 400 });
        }

        await db
            .prepare('INSERT OR IGNORE INTO memos (id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            .bind(id, payload.uid, content, createdAt, now)
            .run();

        return NextResponse.json({ success: true, id });
    } catch (error) {
        console.error('Error creating memo:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
