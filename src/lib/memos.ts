// なんでもメモ共通: 入力検証の定数・関数
export const MEMO_MAX_LENGTH = 1000;
export const MEMO_MAX_COUNT = 1000;

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export function isValidMemoId(id: unknown): id is string {
    return typeof id === 'string' && UUID_RE.test(id);
}

export function normalizeMemoContent(content: unknown): string | null {
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MEMO_MAX_LENGTH) return null;
    return trimmed;
}

export function isValidIsoDate(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

export function isValidDateStr(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
