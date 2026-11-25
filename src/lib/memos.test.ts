import { describe, it, expect } from 'vitest';
import {
    MEMO_MAX_LENGTH,
    isValidDateStr,
    isValidIsoDate,
    isValidMemoId,
    normalizeMemoContent,
} from './memos';

describe('normalizeMemoContent', () => {
    it('前後の空白を除いて返す', () => {
        expect(normalizeMemoContent('  牛乳を買う \n')).toBe('牛乳を買う');
    });
    it('空・空白のみ・文字列以外は null', () => {
        expect(normalizeMemoContent('')).toBeNull();
        expect(normalizeMemoContent('   ')).toBeNull();
        expect(normalizeMemoContent(123)).toBeNull();
        expect(normalizeMemoContent(undefined)).toBeNull();
    });
    it('上限を超えると null、上限ちょうどは許可', () => {
        expect(normalizeMemoContent('あ'.repeat(MEMO_MAX_LENGTH))).not.toBeNull();
        expect(normalizeMemoContent('あ'.repeat(MEMO_MAX_LENGTH + 1))).toBeNull();
    });
});

describe('isValidMemoId', () => {
    it('UUID形式のみ許可', () => {
        expect(isValidMemoId('3fd8c0fc-f1b9-413c-a914-4ca71be649a7')).toBe(true);
        expect(isValidMemoId('abc')).toBe(false);
        expect(isValidMemoId("x'; DROP TABLE memos;--aaaaaaaaaaaaaaaaaaaa")).toBe(false);
        expect(isValidMemoId(undefined)).toBe(false);
    });
});

describe('日付の検証', () => {
    it('isValidDateStr', () => {
        expect(isValidDateStr('2026-11-26')).toBe(true);
        expect(isValidDateStr('2026/11/26')).toBe(false);
        expect(isValidDateStr('2026-13-40')).toBe(false);
    });
    it('isValidIsoDate', () => {
        expect(isValidIsoDate(new Date().toISOString())).toBe(true);
        expect(isValidIsoDate('invalid')).toBe(false);
    });
});
