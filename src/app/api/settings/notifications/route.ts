import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const db = await getDB();

        const setting = await db
            .prepare('SELECT id, user_id, email, email_notification_enabled FROM user_notification_settings WHERE user_id = ? LIMIT 1')
            .bind(payload.uid)
            .first<any>();

        // ユーザーのメールアドレスを取得（通知先メールアドレスの初期値として使用）
        const user = await db
            .prepare('SELECT email FROM users WHERE id = ? LIMIT 1')
            .bind(payload.uid)
            .first<{ email: string }>();

        if (!setting) {
            return NextResponse.json({
                settings: {
                    email: user?.email || null,
                    email_notification_enabled: false,
                },
                loginEmail: user?.email || null,
            });
        }

        return NextResponse.json({
            settings: {
                email: setting.email || null,
                email_notification_enabled: setting.email_notification_enabled === 1,
            },
            loginEmail: user?.email || null,
        });
    } catch (error) {
        console.error('Failed to fetch notification settings:', error);
        return NextResponse.json({ error: 'Failed to fetch notification settings' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as any;
        const { email, email_notification_enabled } = body;

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
        }

        const db = await getDB();
        const now = new Date().toISOString();

        const existing = await db
            .prepare('SELECT id FROM user_notification_settings WHERE user_id = ? LIMIT 1')
            .bind(payload.uid)
            .first<{ id: string }>();

        if (!existing) {
            const id = crypto.randomUUID();
            await db
                .prepare('INSERT INTO user_notification_settings (id, user_id, email, email_notification_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(id, payload.uid, email || null, email_notification_enabled ? 1 : 0, now, now)
                .run();
        } else {
            await db
                .prepare('UPDATE user_notification_settings SET email = ?, email_notification_enabled = ?, updated_at = ? WHERE user_id = ?')
                .bind(email || null, email_notification_enabled ? 1 : 0, now, payload.uid)
                .run();
        }

        return NextResponse.json({
            success: true,
            settings: {
                email: email || null,
                email_notification_enabled: email_notification_enabled || false,
            },
        });
    } catch (error) {
        console.error('Failed to update notification settings:', error);
        return NextResponse.json({ error: 'Failed to update notification settings' }, { status: 500 });
    }
}
