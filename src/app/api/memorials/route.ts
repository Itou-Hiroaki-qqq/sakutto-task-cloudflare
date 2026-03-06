import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getMemorialsForDate, getAllMemorials } from '@/lib/memorials';
import { getDB } from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const dateStr = searchParams.get('date');

        if (dateStr) {
            const date = new Date(dateStr);
            const memorials = await getMemorialsForDate(payload.uid, date);
            return NextResponse.json({ memorials });
        } else {
            const memorials = await getAllMemorials(payload.uid);
            return NextResponse.json({ memorials });
        }
    } catch (error) {
        console.error('Error fetching memorials:', error);
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
        const { title, dueDate, notificationEnabled, notificationTime, yearlyEnabled, isHoliday } = body;

        if (!title || !dueDate) {
            return NextResponse.json({ error: 'Title and due date are required' }, { status: 400 });
        }

        const db = await getDB();
        const memorialId = crypto.randomUUID();
        const now = new Date().toISOString();

        await db
            .prepare('INSERT INTO memorials (id, user_id, title, due_date, notification_enabled, notification_time, is_holiday, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(memorialId, payload.uid, title, dueDate, notificationEnabled ? 1 : 0, notificationTime || null, isHoliday ? 1 : 0, now, now)
            .run();

        if (yearlyEnabled) {
            const recId = crypto.randomUUID();
            await db
                .prepare('INSERT INTO memorial_recurrences (id, memorial_id, type) VALUES (?, ?, ?)')
                .bind(recId, memorialId, 'yearly')
                .run();
        }

        return NextResponse.json({ success: true, memorialId });
    } catch (error) {
        console.error('Error creating memorial:', error);
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
        const { memorialId, title, dueDate, notificationEnabled, notificationTime, yearlyEnabled, isHoliday } = body;

        if (!memorialId || !title || !dueDate) {
            return NextResponse.json({ error: 'Memorial ID, title and due date are required' }, { status: 400 });
        }

        const db = await getDB();
        const now = new Date().toISOString();

        await db
            .prepare('UPDATE memorials SET title = ?, due_date = ?, notification_enabled = ?, notification_time = ?, is_holiday = ?, updated_at = ? WHERE id = ? AND user_id = ?')
            .bind(title, dueDate, notificationEnabled ? 1 : 0, notificationTime || null, isHoliday ? 1 : 0, now, memorialId, payload.uid)
            .run();

        await db.prepare('DELETE FROM memorial_recurrences WHERE memorial_id = ?').bind(memorialId).run();

        if (yearlyEnabled) {
            const recId = crypto.randomUUID();
            await db
                .prepare('INSERT INTO memorial_recurrences (id, memorial_id, type) VALUES (?, ?, ?)')
                .bind(recId, memorialId, 'yearly')
                .run();
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating memorial:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
