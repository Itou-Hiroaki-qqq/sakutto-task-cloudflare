import { DisplayTask } from '@/types/database';
import { format, addMonths, subMonths, isBefore, isAfter, parseISO, startOfDay } from 'date-fns';

// キャッシュの型定義
interface TasksCacheEntry {
    tasks: Record<string, DisplayTask[]>;
    timestamp: number;
    startDate: string;
    endDate: string;
}

const CACHE_KEY_PREFIX = 'tasks_cache_';
const CACHE_TTL = 5 * 60 * 1000; // 5分

function getCacheKey(userId: string): string {
    return `${CACHE_KEY_PREFIX}${userId}`;
}

export function isWithinCurrentMonthRange(date: Date, centerDate: Date = new Date()): boolean {
    const startDate = subMonths(centerDate, 1);
    const endDate = addMonths(centerDate, 2);
    const checkDate = startOfDay(date);
    const start = startOfDay(startDate);
    const end = startOfDay(endDate);
    return checkDate >= start && checkDate <= end;
}

export function getTasksCache(userId: string): TasksCacheEntry | null {
    try {
        const key = getCacheKey(userId);
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        const entry: TasksCacheEntry = JSON.parse(cached);
        const now = Date.now();
        if (now - entry.timestamp > CACHE_TTL) {
            localStorage.removeItem(key);
            return null;
        }
        return entry;
    } catch {
        return null;
    }
}

export function setTasksCache(
    userId: string,
    tasks: Record<string, DisplayTask[]>,
    startDate: string,
    endDate: string
): void {
    const key = getCacheKey(userId);
    const entry: TasksCacheEntry = { tasks, timestamp: Date.now(), startDate, endDate };
    try {
        localStorage.setItem(key, JSON.stringify(entry));
    } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            clearAllTasksCache();
            try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* ignore */ }
        }
    }
}

export function getTasksCacheWithoutTTL(userId: string): TasksCacheEntry | null {
    try {
        const key = getCacheKey(userId);
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        return JSON.parse(cached) as TasksCacheEntry;
    } catch {
        return null;
    }
}

export function getCachedTasksForDate(userId: string, date: Date): DisplayTask[] | null {
    const cache = getTasksCache(userId);
    if (!cache) return null;
    const dateStr = format(date, 'yyyy-MM-dd');
    const tasks = cache.tasks[dateStr];
    if (!tasks) return null;
    const cacheStart = parseISO(cache.startDate);
    const cacheEnd = parseISO(cache.endDate);
    const checkDate = startOfDay(date);
    if (checkDate < startOfDay(cacheStart) || checkDate > startOfDay(cacheEnd)) return null;
    return tasks;
}

export function getCachedTasksForDateWithoutTTL(userId: string, date: Date): DisplayTask[] | null {
    const cache = getTasksCacheWithoutTTL(userId);
    if (!cache) return null;
    const dateStr = format(date, 'yyyy-MM-dd');
    const tasks = cache.tasks[dateStr];
    if (!tasks) return null;
    const cacheStart = parseISO(cache.startDate);
    const cacheEnd = parseISO(cache.endDate);
    const checkDate = startOfDay(date);
    if (checkDate < startOfDay(cacheStart) || checkDate > startOfDay(cacheEnd)) return null;
    return tasks.map(task => ({
        ...task,
        date: typeof task.date === 'string' ? parseISO(task.date) : task.date,
        due_date: typeof task.due_date === 'string' ? parseISO(task.due_date) : task.due_date,
        created_at: task.created_at
            ? typeof task.created_at === 'string' ? parseISO(task.created_at) : task.created_at
            : undefined,
    }));
}

export function updateTasksCache(
    userId: string,
    tasks: Record<string, DisplayTask[]>,
    startDate: string,
    endDate: string
): void {
    const existingCache = getTasksCache(userId);
    if (existingCache) {
        const mergedTasks = { ...existingCache.tasks, ...tasks };
        const existingStart = parseISO(existingCache.startDate);
        const existingEnd = parseISO(existingCache.endDate);
        const newStart = parseISO(startDate);
        const newEnd = parseISO(endDate);
        const mergedStartDate = isBefore(newStart, existingStart) ? startDate : existingCache.startDate;
        const mergedEndDate = isAfter(newEnd, existingEnd) ? endDate : existingCache.endDate;
        setTasksCache(userId, mergedTasks, mergedStartDate, mergedEndDate);
    } else {
        setTasksCache(userId, tasks, startDate, endDate);
    }
}

export function clearTasksCache(userId: string, dateStr?: string): void {
    try {
        const key = getCacheKey(userId);
        if (dateStr) {
            const cache = getTasksCache(userId);
            if (cache) {
                const { [dateStr]: _removed, ...rest } = cache.tasks;
                setTasksCache(userId, rest, cache.startDate, cache.endDate);
            }
        } else {
            localStorage.removeItem(key);
        }
    } catch { /* ignore */ }
}

export function clearAllTasksCache(): void {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(CACHE_KEY_PREFIX)) localStorage.removeItem(key);
        });
    } catch { /* ignore */ }
}

const OVERRIDE_KEY_PREFIX = 'tasks_override_';

function getOverrideKey(userId: string, dateStr: string): string {
    return `${OVERRIDE_KEY_PREFIX}${userId}_${dateStr}`;
}

export function setTasksOverride(userId: string, dateStr: string, tasks: DisplayTask[]): void {
    try {
        const serialized = tasks.map((t) => ({
            ...t,
            date: t.date instanceof Date ? t.date.toISOString() : t.date,
            due_date: t.due_date instanceof Date ? t.due_date.toISOString() : t.due_date,
            created_at: t.created_at instanceof Date ? t.created_at.toISOString() : t.created_at,
        }));
        sessionStorage.setItem(getOverrideKey(userId, dateStr), JSON.stringify(serialized));
    } catch { /* ignore */ }
}

export function getTasksOverride(userId: string, dateStr: string): DisplayTask[] | null {
    try {
        const raw = sessionStorage.getItem(getOverrideKey(userId, dateStr));
        if (!raw) return null;
        const arr = JSON.parse(raw) as any[];
        return arr.map((t) => ({
            ...t,
            date: typeof t.date === 'string' ? parseISO(t.date) : t.date,
            due_date: typeof t.due_date === 'string' ? parseISO(t.due_date) : t.due_date,
            created_at: t.created_at
                ? typeof t.created_at === 'string' ? parseISO(t.created_at) : t.created_at
                : undefined,
        }));
    } catch {
        return null;
    }
}

export function clearTasksOverride(userId: string, dateStr: string): void {
    try {
        sessionStorage.removeItem(getOverrideKey(userId, dateStr));
    } catch { /* ignore */ }
}
