import { NextResponse } from 'next/server';

// Gemini API の使いすぎ（費用の増加）を防ぐためのガード。
// 新規登録が自由なため、アカウントを大量に作られても1日の合計に上限がかかるようにしている。
// 上限は環境変数（wrangler の [vars] など）で変更できる。
const DEFAULT_PER_USER_LIMIT = 30;
const DEFAULT_TOTAL_LIMIT = 150;

/** アップロードできる1ファイルの最大サイズ */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** 1回のアップロードの合計最大サイズ */
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
/** アップロードを許可するファイルの種類 */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

let tableReady = false;

function readLimit(name: string, fallback: number): number {
    const n = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function ensureTable(db: D1Database): Promise<void> {
    if (tableReady) return;
    await db
        .prepare(
            'CREATE TABLE IF NOT EXISTS gemini_usage (day TEXT NOT NULL, scope TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope))'
        )
        .run();
    tableReady = true;
}

async function increment(db: D1Database, day: string, scope: string): Promise<number> {
    const row = await db
        .prepare(
            'INSERT INTO gemini_usage (day, scope, count) VALUES (?, ?, 1) ON CONFLICT(day, scope) DO UPDATE SET count = count + 1 RETURNING count'
        )
        .bind(day, scope)
        .first<{ count: number }>();
    return row?.count ?? 1;
}

/**
 * Gemini を呼ぶ前に、1日の利用回数を確認して1回分を使う。
 * 上限を超えている場合（または確認できない場合）は、返すべきエラーレスポンスを返す。
 * 問題がなければ null を返す。
 */
export async function consumeGeminiQuota(db: D1Database, uid: string): Promise<NextResponse | null> {
    try {
        await ensureTable(db);
        const day = new Date().toISOString().slice(0, 10);

        const perUser = await increment(db, day, `user:${uid}`);
        if (perUser > readLimit('GEMINI_DAILY_LIMIT_PER_USER', DEFAULT_PER_USER_LIMIT)) {
            return NextResponse.json(
                { error: '本日のAI利用回数の上限に達しました。明日またお試しください' },
                { status: 429 }
            );
        }

        const total = await increment(db, day, 'total');
        if (total > readLimit('GEMINI_DAILY_LIMIT_TOTAL', DEFAULT_TOTAL_LIMIT)) {
            return NextResponse.json(
                { error: '本日のAI利用が混み合っています。明日またお試しください' },
                { status: 429 }
            );
        }
        return null;
    } catch (err) {
        // 回数を確認できない場合は、費用の暴走を避けるため処理しない
        console.error('gemini guard error:', err);
        return NextResponse.json({ error: '現在ご利用いただけません' }, { status: 503 });
    }
}
