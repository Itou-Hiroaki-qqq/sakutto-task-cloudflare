// 日本の祝日データを内閣府CSVから取得し、D1の holidays テーブルに同期する処理。
// 年2回（1月・3月）、外部スケジューラーから /api/cron/holidays-sync を叩くことで実行される。

const CABINET_OFFICE_CSV_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
const HOLIDAYS_JP_API_URL = 'https://holidays-jp.github.io/api/v1/date.json';

export interface HolidayRecord {
    date: string; // 'YYYY-MM-DD'
    name: string;
}

export interface HolidayDiff {
    added: HolidayRecord[];
    removed: HolidayRecord[];
    changed: { date: string; oldName: string; newName: string }[];
}

export type HolidaySource = 'cabinet_office' | 'holidays_jp_fallback';

export interface SyncHolidaysResult {
    status: 'success' | 'failed';
    source?: HolidaySource;
    added: number;
    updated: number;
    removed: number;
    error?: string;
}

// 内閣府CSVを取得し、Shift_JIS→UTF-8にデコードしてパースする
export async function fetchCabinetOfficeCsv(): Promise<HolidayRecord[]> {
    const res = await fetch(CABINET_OFFICE_CSV_URL);
    if (!res.ok) {
        throw new Error(`内閣府CSV取得失敗: HTTP ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder('shift_jis').decode(buffer);
    return parseCabinetOfficeCsv(text);
}

// 内閣府CSVのテキスト（デコード済み）をパースする
// フォーマット: 1行目ヘッダー、以降 "YYYY/M/D,祝日名" の2列（CRLF改行）
export function parseCabinetOfficeCsv(text: string): HolidayRecord[] {
    const lines = text.split(/\r\n|\n/).map(line => line.trim()).filter(Boolean);
    const records: HolidayRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const commaIndex = line.indexOf(',');
        if (commaIndex === -1) continue;

        const dateStr = line.slice(0, commaIndex).trim();
        const name = line.slice(commaIndex + 1).trim();
        const match = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
        if (!match || !name) continue;

        const [, y, m, d] = match;
        records.push({ date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, name });
    }

    return records;
}

// フォールバック: holidays-jp API（内閣府CSV取得に失敗した場合のみ使用）
export async function fetchHolidaysJpApiFallback(): Promise<HolidayRecord[]> {
    const res = await fetch(HOLIDAYS_JP_API_URL);
    if (!res.ok) {
        throw new Error(`holidays-jp API取得失敗: HTTP ${res.status}`);
    }
    const json = await res.json() as Record<string, string>;
    return Object.entries(json).map(([date, name]) => ({ date, name }));
}

// 既存データと新データを比較し、追加・変更・削除された祝日を検出する
export function diffHolidays(oldRecords: HolidayRecord[], newRecords: HolidayRecord[]): HolidayDiff {
    const oldMap = new Map(oldRecords.map(r => [r.date, r.name]));
    const newMap = new Map(newRecords.map(r => [r.date, r.name]));

    const added: HolidayRecord[] = [];
    const changed: { date: string; oldName: string; newName: string }[] = [];
    for (const [date, name] of newMap) {
        const oldName = oldMap.get(date);
        if (oldName === undefined) {
            added.push({ date, name });
        } else if (oldName !== name) {
            changed.push({ date, oldName, newName: name });
        }
    }

    const removed: HolidayRecord[] = [];
    for (const [date, name] of oldMap) {
        if (!newMap.has(date)) {
            removed.push({ date, name });
        }
    }

    return { added, removed, changed };
}

// 祝日データを同期するメイン処理
// 1. 内閣府CSVを取得（失敗時はholidays-jp APIにフォールバック）
// 2. 両方失敗した場合は既存D1データを維持し、失敗ログのみ残す
// 3. 成功時は既存データとの差分を検出してD1に反映し、結果をログに残す
export async function syncHolidays(db: D1Database): Promise<SyncHolidaysResult> {
    const now = new Date().toISOString();
    let records: HolidayRecord[];
    let source: HolidaySource;

    try {
        records = await fetchCabinetOfficeCsv();
        source = 'cabinet_office';
    } catch (cabinetError) {
        console.error('[holidaySync] 内閣府CSV取得に失敗。holidays-jp APIにフォールバックします:', cabinetError);
        try {
            records = await fetchHolidaysJpApiFallback();
            source = 'holidays_jp_fallback';
        } catch (fallbackError) {
            const errorMessage =
                `内閣府CSV・フォールバックの両方が失敗しました。既存のD1データを維持します。` +
                ` cabinet: ${(cabinetError as Error).message} / fallback: ${(fallbackError as Error).message}`;
            console.error('[holidaySync]', errorMessage);

            await db.prepare(
                `INSERT INTO holidays_sync_log (id, executed_at, status, source, error_message)
                 VALUES (?, ?, 'failed', NULL, ?)`
            ).bind(crypto.randomUUID(), now, errorMessage).run();

            return { status: 'failed', added: 0, updated: 0, removed: 0, error: errorMessage };
        }
    }

    const existingRows = await db.prepare('SELECT date, name FROM holidays').all<{ date: string; name: string }>();
    const existing = existingRows.results ?? [];
    const diff = diffHolidays(existing, records);

    const upserts = [...diff.added, ...diff.changed.map(c => ({ date: c.date, name: c.newName }))];
    const statements = [
        ...upserts.map(rec =>
            db.prepare(
                `INSERT INTO holidays (date, name, source, synced_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(date) DO UPDATE SET name = excluded.name, source = excluded.source, synced_at = excluded.synced_at`
            ).bind(rec.date, rec.name, source, now)
        ),
        ...diff.removed.map(rec => db.prepare('DELETE FROM holidays WHERE date = ?').bind(rec.date)),
    ];

    if (statements.length > 0) {
        await db.batch(statements);
    }

    if (diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0) {
        console.log('[holidaySync] 差分を検出しました:', JSON.stringify(diff));
    }

    await db.prepare(
        `INSERT INTO holidays_sync_log
            (id, executed_at, status, source, added_count, updated_count, removed_count, diff_json)
         VALUES (?, ?, 'success', ?, ?, ?, ?, ?)`
    ).bind(
        crypto.randomUUID(), now, source,
        diff.added.length, diff.changed.length, diff.removed.length,
        JSON.stringify(diff)
    ).run();

    return {
        status: 'success',
        source,
        added: diff.added.length,
        updated: diff.changed.length,
        removed: diff.removed.length,
    };
}
