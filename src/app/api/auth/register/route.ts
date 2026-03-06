import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { signJWT, COOKIE_NAME, EXPIRES_IN } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const { name, email, password } = await request.json() as any;

        if (!name || !email || !password) {
            return NextResponse.json({ error: '名前、メール、パスワードは必須です' }, { status: 400 });
        }

        if (password.length < 6) {
            return NextResponse.json({ error: 'パスワードは6文字以上で入力してください' }, { status: 400 });
        }

        const db = await getDB();

        const existing = await db
            .prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
            .bind(email)
            .first<{ id: string }>();

        if (existing) {
            return NextResponse.json({ error: 'このメールアドレスは既に登録されています' }, { status: 409 });
        }

        const passwordHash = await hashPassword(password);
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();

        await db
            .prepare('INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(userId, email, passwordHash, name, now, now)
            .run();

        const token = await signJWT(userId);

        const response = NextResponse.json({ success: true });
        response.cookies.set(COOKIE_NAME, token, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: EXPIRES_IN,
            path: '/',
        });

        return response;
    } catch (error) {
        console.error('Register error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
