import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { signJWT, COOKIE_NAME, EXPIRES_IN } from '@/lib/auth';

export async function POST(request: NextRequest) {
    try {
        const { email, password } = await request.json() as any;

        if (!email || !password) {
            return NextResponse.json({ error: 'メールアドレスとパスワードは必須です' }, { status: 400 });
        }

        const db = await getDB();

        const user = await db
            .prepare('SELECT id, password_hash FROM users WHERE email = ? LIMIT 1')
            .bind(email)
            .first<{ id: string; password_hash: string }>();

        if (!user) {
            return NextResponse.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, { status: 401 });
        }

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
            return NextResponse.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, { status: 401 });
        }

        const token = await signJWT(user.id);

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
        console.error('Login error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
