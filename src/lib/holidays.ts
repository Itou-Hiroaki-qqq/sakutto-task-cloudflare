import { Holiday } from '@/types/database';

const holidayMap = new Map<string, Holiday>();

function formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function initializeHolidays() {
    const holidays = generateHolidays();
    holidays.forEach(holiday => {
        const key = formatDateKey(holiday.date);
        holidayMap.set(key, holiday);
    });
}

initializeHolidays();

export function getHoliday(date: Date): Holiday | undefined {
    const key = formatDateKey(date);
    return holidayMap.get(key);
}

export function isHoliday(date: Date): boolean {
    return getHoliday(date) !== undefined;
}

// 春分の日・秋分の日の日付を天文学的近似式で計算する
// 出典: 国立天文台の暦要項に基づく近似式（1980〜2099年の範囲で有効）
// 内閣府が公式発表する暦要項（当年+1年分のみ）が未反映の年でも、この近似式で
// 実際の日付とほぼ一致する値を計算できる
function getVernalEquinoxDay(year: number): number {
    return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

function getAutumnalEquinoxDay(year: number): number {
    return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

function generateHolidays(): Holiday[] {
    const generated: Holiday[] = [];
    const currentYear = new Date().getFullYear();

    for (let year = currentYear - 1; year <= currentYear + 20; year++) {
        generated.push({ date: new Date(year, 0, 1), name: '元日', type: 'national' });
        generated.push({ date: new Date(year, 0, 2), name: '銀行休業日', type: 'bank' });
        generated.push({ date: new Date(year, 0, 3), name: '銀行休業日', type: 'bank' });
        generated.push({ date: new Date(year, 1, 11), name: '建国記念の日', type: 'national' });
        generated.push({ date: new Date(year, 3, 29), name: '昭和の日', type: 'national' });
        generated.push({ date: new Date(year, 4, 3), name: '憲法記念日', type: 'national' });
        generated.push({ date: new Date(year, 4, 4), name: 'みどりの日', type: 'national' });
        generated.push({ date: new Date(year, 4, 5), name: 'こどもの日', type: 'national' });
        generated.push({ date: new Date(year, 9, 12), name: 'スポーツの日', type: 'national' });
        generated.push({ date: new Date(year, 10, 3), name: '文化の日', type: 'national' });
        generated.push({ date: new Date(year, 10, 23), name: '勤労感謝の日', type: 'national' });

        generated.push({ date: getNthMondayOfMonth(year, 0, 2), name: '成人の日', type: 'national' });
        generated.push({ date: getNthMondayOfMonth(year, 6, 3), name: '海の日', type: 'national' });
        generated.push({ date: new Date(year, 7, 11), name: '山の日', type: 'national' });
        generated.push({ date: getNthMondayOfMonth(year, 8, 3), name: '敬老の日', type: 'national' });

        generated.push({ date: new Date(year, 2, getVernalEquinoxDay(year)), name: '春分の日', type: 'national' });
        generated.push({ date: new Date(year, 8, getAutumnalEquinoxDay(year)), name: '秋分の日', type: 'national' });
    }

    const nationalDates = generated.filter(h => h.type === 'national');
    const nationalKeySet = new Set(nationalDates.map(h => formatDateKey(h.date)));

    // 国民の休日: 前日・翌日がともに「国民の祝日」で、当日自体は祝日でも
    // 日曜日でもない日（例: 敬老の日と秋分の日に挟まれた火曜日）
    const citizensHolidays: Holiday[] = [];
    for (const h of nationalDates) {
        const nextDay = new Date(h.date);
        nextDay.setDate(nextDay.getDate() + 2);
        if (nextDay.getDay() === 0) continue; // 挟まれる日が日曜なら不要（休日として別扱い）

        const middleDay = new Date(h.date);
        middleDay.setDate(middleDay.getDate() + 1);
        const middleKey = formatDateKey(middleDay);

        if (nationalKeySet.has(middleKey)) continue;
        if (!nationalKeySet.has(formatDateKey(nextDay))) continue;

        citizensHolidays.push({ date: middleDay, name: '国民の休日', type: 'national' });
    }

    const allNational = [...nationalDates, ...citizensHolidays];
    const allNationalKeySet = new Set(allNational.map(h => formatDateKey(h.date)));

    // 振替休日: 「国民の祝日」（国民の休日を含む）が日曜日と重なった場合、
    // 日曜でも祝日でもない直近の平日に振り替える
    const substitutes: Holiday[] = [];
    for (const h of allNational) {
        if (h.date.getDay() !== 0) continue;
        const next = new Date(h.date);
        do {
            next.setDate(next.getDate() + 1);
        } while (next.getDay() === 0 || allNationalKeySet.has(formatDateKey(next)));
        allNationalKeySet.add(formatDateKey(next));
        substitutes.push({ date: next, name: '振替休日', type: 'national' });
    }

    return [...generated, ...citizensHolidays, ...substitutes];
}

function getNthMondayOfMonth(year: number, month: number, n: number): Date {
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();
    const daysUntilMonday = (1 - firstDayOfWeek + 7) % 7;
    const nthMonday = 1 + daysUntilMonday + (n - 1) * 7;
    return new Date(year, month, nthMonday);
}
