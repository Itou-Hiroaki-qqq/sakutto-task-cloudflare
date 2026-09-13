import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getDB } from '@/lib/db';

// D1に同期済みの祝日データを年単位で返す（カレンダー画面のフォールバック元より正確なデータ）
export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const year = request.nextUrl.searchParams.get('year');
        if (!year || !/^\d{4}$/.test(year)) {
            return NextResponse.json({ error: 'year parameter is required (YYYY)' }, { status: 400 });
        }

        const db = await getDB();
        const { results } = await db
            .prepare('SELECT date, name FROM holidays WHERE date LIKE ? ORDER BY date')
            .bind(`${year}-%`)
            .all<{ date: string; name: string }>();

        return NextResponse.json({ holidays: results ?? [] });
    } catch (error) {
        console.error('[api/holidays] エラー:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
