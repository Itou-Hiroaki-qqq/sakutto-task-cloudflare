import { describe, it, expect } from 'vitest';
import { getHoliday, isHoliday } from './holidays';

describe('holidays (ローカル計算フォールバック)', () => {
    it('春分の日を正しく計算できる（2025年3月20日・国立天文台発表値と一致）', () => {
        const holiday = getHoliday(new Date(2025, 2, 20));
        expect(holiday?.name).toBe('春分の日');
    });

    it('秋分の日を正しく計算できる（2025年9月23日・国立天文台発表値と一致）', () => {
        const holiday = getHoliday(new Date(2025, 8, 23));
        expect(holiday?.name).toBe('秋分の日');
    });

    it('国民の休日を正しく割り当てる（2026年シルバーウィーク：敬老の日と秋分の日に挟まれた火曜日）', () => {
        expect(getHoliday(new Date(2026, 8, 21))?.name).toBe('敬老の日');
        expect(getHoliday(new Date(2026, 8, 22))?.name).toBe('国民の休日');
        expect(getHoliday(new Date(2026, 8, 23))?.name).toBe('秋分の日');
    });

    it('日曜と重なった祝日の振替休日を正しく割り当てる（2026年5月6日）', () => {
        // 2026/5/3(日)憲法記念日 → 5/4(月)みどりの日, 5/5(火)こどもの日と連続するため
        // 振替休日は 5/6(水) にずれる
        const holiday = getHoliday(new Date(2026, 4, 6));
        expect(holiday?.name).toBe('振替休日');
    });

    it('祝日でない日は undefined を返す', () => {
        expect(isHoliday(new Date(2026, 5, 15))).toBe(false);
    });
});
