import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const db = await getDB();
        const user = await db
            .prepare('SELECT id, email, name FROM users WHERE id = ? LIMIT 1')
            .bind(payload.uid)
            .first<{ id: string; email: string; name: string }>();

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({ user });
    } catch (error) {
        console.error('Me error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
