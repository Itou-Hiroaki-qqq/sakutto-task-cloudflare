'use client';

import { Holiday } from '@/types/database';
import { getHoliday as getLocalHoliday } from '@/lib/holidays';

// D1に同期された祝日データ（内閣府CSV由来）をクライアント側に年単位でキャッシュする。
// 未取得・取得失敗の間は holidays.ts のローカル計算値を表示に使う（オフラインでも動く）ため、
// カレンダー表示が壊れることはない。

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const CACHE_KEY_PREFIX = 'holidays-cache-v1-';

const yearCache = new Map<number, Map<string, Holiday>>();
const loadingYears = new Set<number>();
const listeners = new Set<() => void>();

interface StoredHoliday {
    date: string;
    name: string;
}

interface StoredCache {
    savedAt: number;
    holidays: StoredHoliday[];
}

function toHolidayMap(holidays: StoredHoliday[]): Map<string, Holiday> {
    const map = new Map<string, Holiday>();
    holidays.forEach(h => {
        map.set(h.date, { date: new Date(`${h.date}T00:00:00`), name: h.name, type: 'national' });
    });
    return map;
}

function loadFromLocalStorage(year: number): Map<string, Holiday> | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY_PREFIX + year);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredCache;
        if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
        return toHolidayMap(parsed.holidays);
    } catch {
        return null;
    }
}

function saveToLocalStorage(year: number, holidays: StoredHoliday[]) {
    try {
        const payload: StoredCache = { savedAt: Date.now(), holidays };
        localStorage.setItem(CACHE_KEY_PREFIX + year, JSON.stringify(payload));
    } catch {
        // localStorageが使えない環境（プライベートウィンドウ等）は無視して継続する
    }
}

function notifyListeners() {
    listeners.forEach(listener => listener());
}

// D1同期データの取得完了時に再描画したいコンポーネントから呼ぶ
export function subscribeHolidaysLoaded(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// 指定年のD1同期データを読み込む（副作用あり）。useEffect等、描画の外から呼ぶこと。
export function ensureHolidaysLoaded(year: number): void {
    if (yearCache.has(year) || loadingYears.has(year)) return;

    const cached = loadFromLocalStorage(year);
    if (cached) {
        yearCache.set(year, cached);
        return;
    }

    loadingYears.add(year);
    fetch(`/api/holidays?year=${year}`)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(`failed with status ${res.status}`))) as Promise<{ holidays: StoredHoliday[] }>)
        .then((data) => {
            yearCache.set(year, toHolidayMap(data.holidays));
            saveToLocalStorage(year, data.holidays);
            notifyListeners();
        })
        .catch(() => {
            // 取得失敗時はキャッシュに入れず、ローカル計算のフォールバックを使い続ける
        })
        .finally(() => {
            loadingYears.delete(year);
        });
}

function formatDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 描画中に呼んで良い純粋な読み取り。
// D1同期データにその日付の登録があればそれを優先し、無ければローカル計算値にフォールバックする
// （年単位でキャッシュしていても、CSV由来データが万一その年を部分的にしか含んでいない場合に
// 「本来祝日のはずの日が何も表示されない」事故を避けるため、日付単位でフォールバックする）
export function getHolidayWithRemote(date: Date): Holiday | undefined {
    const map = yearCache.get(date.getFullYear());
    const remoteHoliday = map?.get(formatDateKey(date));
    return remoteHoliday ?? getLocalHoliday(date);
}
