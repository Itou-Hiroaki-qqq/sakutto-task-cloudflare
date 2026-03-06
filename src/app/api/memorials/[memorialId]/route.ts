import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ memorialId: string }> }
) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { memorialId } = await params;
        const db = await getDB();

        const memorial = await db
            .prepare(`
                SELECT
                    m.id, m.title, m.due_date, m.notification_enabled, m.notification_time, m.is_holiday,
                    mr.type as recurrence_type, mr.custom_days, mr.custom_unit, mr.weekdays as recurrence_weekdays
                FROM memorials m
                LEFT JOIN memorial_recurrences mr ON m.id = mr.memorial_id
                WHERE m.id = ? AND m.user_id = ?
            `)
            .bind(memorialId, payload.uid)
            .first<any>();

        if (!memorial) {
            return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
        }

        return NextResponse.json({
            memorial: {
                id: memorial.id,
                title: memorial.title,
                due_date: memorial.due_date,
                notification_enabled: memorial.notification_enabled === 1,
                notification_time: memorial.notification_time,
                is_holiday: memorial.is_holiday === 1,
                recurrence: memorial.recurrence_type
                    ? {
                          type: memorial.recurrence_type,
                          custom_days: memorial.custom_days,
                          custom_unit: memorial.custom_unit,
                          weekdays: memorial.recurrence_weekdays
                              ? (() => { try { return JSON.parse(memorial.recurrence_weekdays); } catch { return null; } })()
                              : null,
                      }
                    : null,
            },
        });
    } catch (error) {
        console.error('Error fetching memorial:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ memorialId: string }> }
) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { memorialId } = await params;
        const db = await getDB();

        await db
            .prepare('DELETE FROM memorials WHERE id = ? AND user_id = ?')
            .bind(memorialId, payload.uid)
            .run();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting memorial:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
