// OpenNext が生成するワーカーを包み、Cloudflare の Cron Trigger（wrangler.toml の [triggers]）を
// 受け取れるようにする。OpenNext 標準のワーカーには scheduled() が無く、
// そのままだと毎分「Handler does not export a scheduled() function」で失敗して通知が送られない。
//
// 毎分、アプリ内の /api/cron/notifications を内部呼び出しする（CRON_SECRET で認証）。

// @ts-ignore: .open-next/worker.js は `opennextjs-cloudflare build` で生成される
import handler from './.open-next/worker.js';

// @ts-ignore: OpenNext が生成するワーカーが export している Durable Object。再 export が必要
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

const NOTIFICATION_URL = 'https://sakutto-task.chiteijin315.workers.dev/api/cron/notifications';

interface WorkerEnv {
    CRON_SECRET?: string;
}

export default {
    fetch: handler.fetch,

    async scheduled(_controller: unknown, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }) {
        const run = async () => {
            const headers: Record<string, string> = {};
            if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;

            const res = await handler.fetch(
                new Request(NOTIFICATION_URL, { method: 'POST', headers }),
                env,
                ctx
            );
            const body = await res.text();
            if (!res.ok) {
                console.error(`[cron] notifications failed: ${res.status} ${body}`);
            } else {
                console.log(`[cron] notifications: ${body}`);
            }
        };
        ctx.waitUntil(run());
    },
};
