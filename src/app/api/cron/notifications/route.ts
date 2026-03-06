import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Cloudflare Cron Triggerから呼び出されるエンドポイント
// wrangler.toml: crons = ["*/1 * * * *"] で1分ごとに実行される
export async function POST(request: NextRequest) {
    try {
        const { env } = await getCloudflareContext({ async: true });

        // 認証（セキュリティのため）
        const authHeader = request.headers.get('authorization');
        const cronSecret = env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = env.RESEND_API_KEY;
        const fromEmail = env.RESEND_FROM_EMAIL || 'Sakutto Task <onboarding@resend.dev>';

        if (!apiKey) {
            return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 500 });
        }

        const now = new Date();
        const jstTime = toZonedTime(now, 'Asia/Tokyo');

        // 時刻を1分刻みのまま使用（Cloudflare Cron Triggerは1分ごとに呼び出される）
        const currentDate = format(jstTime, 'yyyy-MM-dd');
        const currentTime = format(jstTime, 'HH:mm');

        const result = await sendNotificationsForDateTime(jstTime, currentTime, apiKey, fromEmail);

        return NextResponse.json({
            success: true,
            date: currentDate,
            time: currentTime,
            emailCount: result.emailCount,
            errors: result.errors,
        });
    } catch (error) {
        console.error('Failed to process notifications:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
