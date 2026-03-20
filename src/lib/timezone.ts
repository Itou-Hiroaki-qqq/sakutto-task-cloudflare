import { isSameDay } from 'date-fns';

/**
 * Cloudflare Workers (UTC) 上でJST基準の「今日」を取得する
 */
export function getTodayJST(): Date {
    const now = new Date();
    const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
    const jstDate = new Date(jstMs);
    return new Date(jstDate.getUTCFullYear(), jstDate.getUTCMonth(), jstDate.getUTCDate());
}

/**
 * 指定日がJST基準で「今日」かどうか判定する
 */
export function isTodayJST(date: Date): boolean {
    const todayJST = getTodayJST();
    return isSameDay(date, todayJST);
}
