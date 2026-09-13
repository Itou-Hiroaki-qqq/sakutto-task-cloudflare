import { describe, it, expect, vi, afterEach } from 'vitest';
import iconv from 'iconv-lite';
import {
    parseCabinetOfficeCsv,
    fetchCabinetOfficeCsv,
    fetchHolidaysJpApiFallback,
    diffHolidays,
    syncHolidays,
} from './holidaySync';

// D1Database の最小限のフェイク実装（テスト用）
class FakeStatement {
    private args: unknown[] = [];
    constructor(private sql: string, private db: FakeD1) {}

    bind(...args: unknown[]) {
        this.args = args;
        return this;
    }

    async run() {
        const sql = this.sql.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('INSERT INTO holidays_sync_log')) {
            this.db.logs.push({ sql, args: this.args });
        } else if (sql.startsWith('INSERT INTO holidays')) {
            const [date, name, source, synced_at] = this.args as [string, string, string, string];
            this.db.holidays.set(date, { date, name, source, synced_at });
        } else if (sql.startsWith('DELETE FROM holidays')) {
            const [date] = this.args as [string];
            this.db.holidays.delete(date);
        }
        return { success: true } as D1Result;
    }

    async all<T>() {
        return { results: Array.from(this.db.holidays.values()).map(h => ({ date: h.date, name: h.name })) as unknown as T[] } as D1Result<T>;
    }

    async first<T>() {
        return null as unknown as T | null;
    }
}

class FakeD1 {
    holidays = new Map<string, { date: string; name: string; source: string; synced_at: string }>();
    logs: { sql: string; args: unknown[] }[] = [];

    prepare(sql: string) {
        return new FakeStatement(sql, this) as unknown as D1PreparedStatement;
    }

    async batch<T>(statements: D1PreparedStatement[]) {
        const results: D1Result<T>[] = [];
        for (const stmt of statements) {
            results.push(await (stmt as unknown as FakeStatement).run() as unknown as D1Result<T>);
        }
        return results;
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('parseCabinetOfficeCsv', () => {
    it('YYYY/M/D,祝日名 形式をパースできる', () => {
        const csv = '国民の祝日・休日月日,国民の祝日・休日名称\r\n2024/1/1,元日\r\n2024/1/8,成人の日\r\n';
        const result = parseCabinetOfficeCsv(csv);
        expect(result).toEqual([
            { date: '2024-01-01', name: '元日' },
            { date: '2024-01-08', name: '成人の日' },
        ]);
    });

    it('空行やヘッダーのみの場合は空配列を返す', () => {
        expect(parseCabinetOfficeCsv('国民の祝日・休日月日,国民の祝日・休日名称\r\n')).toEqual([]);
    });
});

describe('fetchCabinetOfficeCsv (Shift_JISデコード)', () => {
    it('Shift_JISでエンコードされたCSVを正しくUTF-8にデコードしてパースできる', async () => {
        const sjisText = '国民の祝日・休日月日,国民の祝日・休日名称\r\n2024/1/1,元日\r\n2024/9/23,秋分の日\r\n';
        const sjisBuffer = iconv.encode(sjisText, 'Shift_JIS');

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: async () => sjisBuffer.buffer.slice(sjisBuffer.byteOffset, sjisBuffer.byteOffset + sjisBuffer.byteLength),
        }));

        const result = await fetchCabinetOfficeCsv();
        expect(result).toEqual([
            { date: '2024-01-01', name: '元日' },
            { date: '2024-09-23', name: '秋分の日' },
        ]);
    });

    it('HTTPエラー時は例外を投げる', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        await expect(fetchCabinetOfficeCsv()).rejects.toThrow();
    });
});

describe('fetchHolidaysJpApiFallback', () => {
    it('holidays-jp APIのレスポンスを配列に変換できる', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ '2024-01-01': '元日', '2024-01-08': '成人の日' }),
        }));

        const result = await fetchHolidaysJpApiFallback();
        expect(result).toEqual([
            { date: '2024-01-01', name: '元日' },
            { date: '2024-01-08', name: '成人の日' },
        ]);
    });
});

describe('diffHolidays', () => {
    it('追加・変更・削除を正しく検出する', () => {
        const oldRecords = [
            { date: '2024-01-01', name: '元日' },
            { date: '2024-01-08', name: '成人の日' },
            { date: '2024-09-22', name: '国民の休日' },
        ];
        const newRecords = [
            { date: '2024-01-01', name: '元日' },
            { date: '2024-01-08', name: '成人の日(変更後)' },
            { date: '2024-02-11', name: '建国記念の日' },
        ];

        const diff = diffHolidays(oldRecords, newRecords);
        expect(diff.added).toEqual([{ date: '2024-02-11', name: '建国記念の日' }]);
        expect(diff.changed).toEqual([{ date: '2024-01-08', oldName: '成人の日', newName: '成人の日(変更後)' }]);
        expect(diff.removed).toEqual([{ date: '2024-09-22', name: '国民の休日' }]);
    });
});

describe('syncHolidays', () => {
    it('内閣府CSVの取得に成功したらD1に保存し、成功ログを残す', async () => {
        const sjisText = '国民の祝日・休日月日,国民の祝日・休日名称\r\n2024/1/1,元日\r\n';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: async () => iconv.encode(sjisText, 'Shift_JIS').buffer,
        }));

        const db = new FakeD1();
        const result = await syncHolidays(db as unknown as D1Database);

        expect(result.status).toBe('success');
        expect(result.source).toBe('cabinet_office');
        expect(result.added).toBe(1);
        expect(db.holidays.get('2024-01-01')?.name).toBe('元日');
        expect(db.logs).toHaveLength(1);
    });

    it('内閣府CSVが失敗したらholidays-jp APIにフォールバックする', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 500 }) // 内閣府CSV失敗
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ '2024-01-01': '元日' }) }); // フォールバック成功
        vi.stubGlobal('fetch', fetchMock);

        const db = new FakeD1();
        const result = await syncHolidays(db as unknown as D1Database);

        expect(result.status).toBe('success');
        expect(result.source).toBe('holidays_jp_fallback');
        expect(db.holidays.get('2024-01-01')?.source).toBe('holidays_jp_fallback');
    });

    it('内閣府CSV・フォールバック両方失敗したら既存D1データを維持し、失敗ログを残す', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

        const db = new FakeD1();
        db.holidays.set('2024-01-01', { date: '2024-01-01', name: '元日', source: 'cabinet_office', synced_at: '2024-01-01T00:00:00.000Z' });

        const result = await syncHolidays(db as unknown as D1Database);

        expect(result.status).toBe('failed');
        expect(db.holidays.get('2024-01-01')?.name).toBe('元日'); // 既存データが維持されている
        expect(db.logs).toHaveLength(1);
    });
});
