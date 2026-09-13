import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { syncHolidays } from '@/lib/holidaySync';

// 外部スケジューラー（cron-job.org等）から年2回（1月・3月）呼び出されるエンドポイント
// 既存の /api/cron/notifications と同じ「HTTPエンドポイント + 外部トリガー」方式
export async function POST(request: NextRequest) {
    try {
        const { env } = await getCloudflareContext({ async: true });

        const authHeader = request.headers.get('authorization');
        const cronSecret = env.CRON_SECRET;
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const result = await syncHolidays(env.DB);
        return NextResponse.json(result, { status: result.status === 'success' ? 200 : 500 });
    } catch (error) {
        console.error('[holidays-sync] 予期しないエラー:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
