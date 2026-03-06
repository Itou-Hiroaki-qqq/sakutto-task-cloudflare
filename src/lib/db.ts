import { getCloudflareContext } from '@opennextjs/cloudflare';

// API Route / Server Action 内で呼び出す D1 Database 取得関数
export async function getDB(): Promise<D1Database> {
    const { env } = await getCloudflareContext({ async: true });
    return env.DB;
}
