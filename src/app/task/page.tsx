'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, parseISO, subMonths, addMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import DatePicker from '@/components/DatePicker';
import { RecurrenceType } from '@/types/database';
import { clearTasksCache as clearClientTasksCache, getCachedTasksForDateWithoutTTL, isWithinCurrentMonthRange, setTasksOverride, updateTasksCache } from '@/lib/tasksCache';
import { DisplayTask } from '@/types/database';

function TaskEditPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [userId, setUserId] = useState<string | null>(null);

    // URLパラメータから取得
    const taskIdParam = searchParams.get('taskId');
    const dateParam = searchParams.get('date');
    const carryoverParam = searchParams.get('carryover');
    const isCarryover = carryoverParam === 'true';
    const initialDate = dateParam ? parseISO(dateParam) : new Date();

    // フォーム状態
    const [title, setTitle] = useState('');
    const [timeSuggestion, setTimeSuggestion] = useState<{ pattern: string; converted: string; index: number } | null>(null);
    const [dismissedPatterns, setDismissedPatterns] = useState<Set<string>>(new Set());
    const titleInputRef = useRef<HTMLTextAreaElement>(null);
    const [dueDate, setDueDate] = useState(initialDate);
    const [notificationEnabled, setNotificationEnabled] = useState(false);
    const [notificationTime, setNotificationTime] = useState('');
    const [recurrenceType, setRecurrenceType] = useState<RecurrenceType | null>(null);
    const [customDays, setCustomDays] = useState<number | null>(null);
    const [customUnit, setCustomUnit] = useState<'days' | 'weeks' | 'months' | 'months_end' | 'years'>('days');
    const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [showSaveScopeDialog, setShowSaveScopeDialog] = useState(false);
    const [completionDate, setCompletionDate] = useState<string | null>(null); // 引継ぎタスクの完了日

    // 認証とタスク取得を並列実行して遷移を速くする
    useEffect(() => {
        const dateParam = searchParams.get('date');

        const run = async () => {
            const taskFetchUrl = taskIdParam
                ? `/api/tasks/${taskIdParam}${dateParam ? `?date=${dateParam}` : ''}${isCarryover ? `${dateParam ? '&' : '?'}carryover=true` : ''}`
                : null;
            const [meResponse, taskResponse] = await Promise.all([
                fetch('/api/auth/me'),
                taskFetchUrl ? fetch(taskFetchUrl) : Promise.resolve(null),
            ]);

            if (!meResponse.ok) {
                router.push('/login');
                return;
            }
            const { user } = await meResponse.json() as any;
            setUserId(user.id);

            if (!taskIdParam) {
                const newDateParam = searchParams.get('date');
                if (newDateParam) {
                    try {
                        setDueDate(parseISO(newDateParam));
                    } catch {
                        // パースエラーは無視
                    }
                }
                setLoading(false);
                return;
            }

            if (!taskResponse) {
                setLoading(false);
                return;
            }

            try {
                if (taskResponse.ok) {
                    const data = await taskResponse.json() as any;
                    if (!data.task) {
                        alert('タスクデータが見つかりませんでした');
                        router.back();
                        return;
                    }
                    setTitle(data.task.title || '');
                    const taskDueDate = data.task.due_date ? new Date(data.task.due_date) : initialDate;
                    if (data.recurrence && dateParam) {
                        try {
                            setDueDate(parseISO(dateParam));
                        } catch {
                            setDueDate(taskDueDate);
                        }
                    } else {
                        setDueDate(taskDueDate);
                    }
                    setNotificationEnabled(data.task.notification_enabled || false);
                    setNotificationTime(data.task.notification_time || '');
                    if (data.recurrence) {
                        setRecurrenceType(data.recurrence.type);
                        if (data.recurrence.type === 'custom' && data.recurrence.custom_days) {
                            if (data.recurrence.custom_unit) {
                                setCustomUnit(data.recurrence.custom_unit as 'days' | 'weeks' | 'months' | 'months_end' | 'years');
                                setCustomDays(data.recurrence.custom_days);
                            } else {
                                const days = data.recurrence.custom_days;
                                if (days % 365 === 0) {
                                    setCustomUnit('years');
                                    setCustomDays(days / 365);
                                } else if (days % 30 === 0) {
                                    setCustomUnit('months');
                                    setCustomDays(days / 30);
                                } else if (days % 7 === 0) {
                                    setCustomUnit('weeks');
                                    setCustomDays(days / 7);
                                } else {
                                    setCustomUnit('days');
                                    setCustomDays(days);
                                }
                            }
                        } else {
                            setCustomDays(data.recurrence.custom_days || null);
                        }
                        setSelectedWeekdays(data.recurrence.weekdays || []);
                    } else {
                        setRecurrenceType(null);
                        setCustomDays(null);
                        setCustomUnit('days');
                        setSelectedWeekdays([]);
                    }
                    // 引継ぎタスクの完了情報を取得
                    if (isCarryover && data.completion?.completed) {
                        setCompletionDate(data.completion.completed_date);
                    }
                } else {
                    const errorData = await taskResponse.json() as any;
                    if (taskResponse.status === 404) {
                        alert('タスクが見つかりませんでした。既に削除されている可能性があります。');
                        router.back();
                    } else {
                        alert(`タスクの読み込みに失敗しました: ${errorData.error || 'Unknown error'}`);
                    }
                }
            } catch (e) {
                console.error('Failed to load task:', e);
                alert('タスクの読み込み中にエラーが発生しました');
            } finally {
                setLoading(false);
            }
        };

        if (taskIdParam) setLoading(true);
        run();
    }, [router, taskIdParam, searchParams]);

    // ローディングが完了したらタイトル入力欄にフォーカス
    useEffect(() => {
        if (!loading && userId) {
            const timer = setTimeout(() => {
                if (titleInputRef.current) {
                    titleInputRef.current.focus();
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [loading, userId]);

    const handleSave = () => {
        if (!title.trim() || !userId) {
            alert('タイトルを入力してください');
            return;
        }
        // 繰り返し予定の編集時は範囲選択ダイアログを表示
        if (taskIdParam && recurrenceType !== null && searchParams.get('date')) {
            setShowSaveScopeDialog(true);
            return;
        }
        performSave();
    };

    const performSave = async (updateScope?: 'this_only' | 'all_future') => {
        if (!title.trim() || !userId) {
            alert('タイトルを入力してください');
            return;
        }

        setShowSaveScopeDialog(false);

        // 通知設定が有効な場合、メールアドレス設定の確認
        if (notificationEnabled && notificationTime) {
            try {
                const settingsResponse = await fetch('/api/settings/notifications');
                if (settingsResponse.ok) {
                    const settingsData = await settingsResponse.json() as any;
                    const hasEmail = settingsData.settings?.email && settingsData.settings?.email_notification_enabled;

                    if (!hasEmail) {
                        const returnDate = searchParams.get('date');
                        const returnUrl = `/task${taskIdParam ? `?taskId=${taskIdParam}` : ''}${returnDate ? `&date=${returnDate}` : ''}`;
                        const confirmed = confirm(
                            '通知を送信するには、メールアドレスの設定が必要です。\n通知設定ページに移動しますか？'
                        );
                        if (confirmed) {
                            router.push(`/settings/notifications?returnUrl=${encodeURIComponent(returnUrl)}`);
                            return;
                        } else {
                            return;
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to check notification settings:', error);
            }
        }

        let customDaysToSave: number | null = null;
        let customUnitToSave: 'days' | 'weeks' | 'months' | 'months_end' | 'years' | null = null;
        if (recurrenceType === 'custom' && customDays) {
            customDaysToSave = customDays;
            customUnitToSave = customUnit;
            if (customUnit === 'days') customUnitToSave = null;
        }

        const payload: Record<string, unknown> = {
            taskId: taskIdParam,
            title: title.trim(),
            dueDate: format(dueDate, 'yyyy-MM-dd'),
            notificationEnabled,
            notificationTime: notificationEnabled ? notificationTime : null,
            recurrenceType,
            customDays: customDaysToSave,
            customUnit: customUnitToSave,
            selectedWeekdays: recurrenceType === 'weekdays' ? selectedWeekdays : null,
        };
        if (taskIdParam && recurrenceType && updateScope) {
            payload.updateScope = updateScope;
            const dateParam = searchParams.get('date');
            if (dateParam) payload.targetDate = dateParam;
        }

        const returnDate = searchParams.get('date');
        const returnUrl = searchParams.get('returnUrl') || '/top';
        const dateStrForCache = updateScope === 'this_only' && returnDate ? returnDate : format(dueDate, 'yyyy-MM-dd');
        const occurrenceDate = parseISO(dateStrForCache);

        // 新規タスク: 仮IDで楽観的にキャッシュ挿入→即遷移→バックグラウンドPOST
        if (!taskIdParam) {
            const tempTaskId = `temp-${crypto.randomUUID()}`;
            if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
                const newTask: DisplayTask = {
                    id: `single-${tempTaskId}`,
                    task_id: tempTaskId,
                    title: title.trim(),
                    date: occurrenceDate,
                    due_date: dueDate,
                    notification_time: notificationEnabled ? notificationTime : undefined,
                    completed: false,
                    is_recurring: recurrenceType !== null,
                    created_at: new Date(),
                };
                const existing = getCachedTasksForDateWithoutTTL(userId, occurrenceDate) ?? [];
                const newList = [...existing, newTask];
                updateTasksCache(
                    userId,
                    { [dateStrForCache]: newList },
                    format(subMonths(occurrenceDate, 1), 'yyyy-MM-dd'),
                    format(addMonths(occurrenceDate, 2), 'yyyy-MM-dd')
                );
                setTasksOverride(userId, dateStrForCache, newList);
            }

            if (returnDate) {
                router.push(`${returnUrl}?date=${returnDate}`);
            } else {
                router.push(returnUrl);
            }

            (async () => {
                try {
                    const response = await fetch('/api/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (response.ok) {
                        const data = await (response.json() as Promise<any>);
                        const realTaskId = data.taskId || null;
                        if (realTaskId && userId && isWithinCurrentMonthRange(occurrenceDate)) {
                            const existing = getCachedTasksForDateWithoutTTL(userId, occurrenceDate) ?? [];
                            const updated = existing.map((t) =>
                                t.task_id === tempTaskId
                                    ? { ...t, id: `single-${realTaskId}`, task_id: realTaskId }
                                    : t
                            );
                            updateTasksCache(
                                userId,
                                { [dateStrForCache]: updated },
                                format(subMonths(occurrenceDate, 1), 'yyyy-MM-dd'),
                                format(addMonths(occurrenceDate, 2), 'yyyy-MM-dd')
                            );
                        }
                    } else {
                        const err = await (response.json() as Promise<any>).catch(() => ({}));
                        if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
                            clearClientTasksCache(userId, dateStrForCache);
                        }
                        try { sessionStorage.setItem('task_save_error', err?.error ?? '保存に失敗しました'); } catch (_) {}
                    }
                } catch (_) {
                    if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
                        clearClientTasksCache(userId, dateStrForCache);
                    }
                    try { sessionStorage.setItem('task_save_error', '保存に失敗しました'); } catch (_) {}
                }
            })();
            return;
        }

        // 既存タスク編集: 楽観的更新してから遷移・バックグラウンドPUT
        if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
            if (updateScope === 'all_future') {
                clearClientTasksCache(userId);
            } else if (updateScope === 'this_only') {
                // this_only は新task_idが発行されるため楽観的更新はできない。
                // 該当日のキャッシュを破棄して /top の再フェッチに任せる
                clearClientTasksCache(userId, dateStrForCache);
                if (returnDate && returnDate !== dateStrForCache) {
                    clearClientTasksCache(userId, returnDate);
                }
            } else {
                const optimisticTask: DisplayTask = {
                    id: taskIdParam,
                    task_id: taskIdParam,
                    title: title.trim(),
                    date: occurrenceDate,
                    due_date: dueDate,
                    notification_time: notificationEnabled ? notificationTime : undefined,
                    completed: false,
                    is_recurring: recurrenceType !== null,
                    created_at: new Date(),
                };
                const existing = getCachedTasksForDateWithoutTTL(userId, occurrenceDate) ?? [];
                const newList = existing.map((t) => (t.task_id === taskIdParam ? optimisticTask : t));
                updateTasksCache(
                    userId,
                    { [dateStrForCache]: newList },
                    format(subMonths(occurrenceDate, 1), 'yyyy-MM-dd'),
                    format(addMonths(occurrenceDate, 2), 'yyyy-MM-dd')
                );
                setTasksOverride(userId, dateStrForCache, newList);
            }
        }

        if (returnDate) {
            router.push(`${returnUrl}?date=${returnDate}`);
        } else {
            router.push(returnUrl);
        }

        // 編集保存はバックグラウンドで実行（成功時の refetch は廃止）
        (async () => {
            try {
                const response = await fetch('/api/tasks', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    const err = await (response.json() as Promise<any>).catch(() => ({}));
                    if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
                        clearClientTasksCache(userId, dateStrForCache);
                    }
                    try {
                        sessionStorage.setItem('task_save_error', err?.error ?? '保存に失敗しました');
                    } catch (_) {}
                }
            } catch (_) {
                if (userId && isWithinCurrentMonthRange(occurrenceDate)) {
                    clearClientTasksCache(userId, dateStrForCache);
                }
                try {
                    sessionStorage.setItem('task_save_error', '保存に失敗しました');
                } catch (_) {}
            }
        })();
    };

    // 時刻を5分刻みに丸める関数
    const roundTo5Minutes = (timeString: string): string => {
        if (!timeString || !timeString.includes(':')) {
            return timeString;
        }

        const [hours, minutes] = timeString.split(':').map(Number);
        const roundedMinutes = Math.round(minutes / 5) * 5;

        if (roundedMinutes === 60) {
            return `${String(hours + 1).padStart(2, '0')}:00`;
        }

        return `${String(hours).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
    };

    const handleNotificationTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNotificationTime(e.target.value);
    };

    const handleNotificationTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (value) {
            setNotificationTime(roundTo5Minutes(value));
        }
    };

    const handleWeekdayToggle = (weekday: number) => {
        setSelectedWeekdays((prev) =>
            prev.includes(weekday)
                ? prev.filter((d) => d !== weekday)
                : [...prev, weekday]
        );
    };

    const handleRecurrenceChange = (type: RecurrenceType | null) => {
        setRecurrenceType(type);
        if (type !== 'weekdays') {
            setSelectedWeekdays([]);
        }
        if (type !== 'custom') {
            setCustomDays(null);
            setCustomUnit('days');
        }
    };

    const handleDelete = async (deleteOption?: 'this_only' | 'future_all') => {
        if (!taskIdParam) {
            alert('削除するタスクがありません');
            return;
        }

        const hasRecurrence = recurrenceType !== null;

        if (!deleteOption) {
            setShowDeleteDialog(true);
            return;
        }

        const dateStr = format(dueDate, 'yyyy-MM-dd');
        const taskDate = parseISO(dateStr);
        const returnDate = searchParams.get('date');
        const returnUrl = searchParams.get('returnUrl') || '/top';

        const requestPayload: any = {};
        if (hasRecurrence) {
            requestPayload.deleteOption = deleteOption;
            requestPayload.targetDate = dateStr;
        }

        // 楽観的にキャッシュから除去して即遷移
        if (userId && isWithinCurrentMonthRange(taskDate)) {
            if (hasRecurrence && deleteOption === 'future_all') {
                clearClientTasksCache(userId);
            } else {
                // 単発削除 or 繰り返しの this_only: 該当日のキャッシュから該当タスクを除去
                const targetDateStr = returnDate || dateStr;
                const targetDate = parseISO(targetDateStr);
                const existing = getCachedTasksForDateWithoutTTL(userId, targetDate) ?? [];
                const filtered = existing.filter((t) => t.task_id !== taskIdParam);
                if (isWithinCurrentMonthRange(targetDate)) {
                    updateTasksCache(
                        userId,
                        { [targetDateStr]: filtered },
                        format(subMonths(targetDate, 1), 'yyyy-MM-dd'),
                        format(addMonths(targetDate, 2), 'yyyy-MM-dd')
                    );
                    setTasksOverride(userId, targetDateStr, filtered);
                }
            }
        }

        setShowDeleteDialog(false);
        if (returnDate) {
            router.push(`${returnUrl}?date=${returnDate}`);
        } else {
            router.push(returnUrl);
        }

        // バックグラウンドでDELETE実行
        (async () => {
            try {
                const response = await fetch(`/api/tasks/${taskIdParam}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestPayload),
                });
                if (!response.ok) {
                    const err = await (response.json() as Promise<any>).catch(() => ({}));
                    if (userId && isWithinCurrentMonthRange(taskDate)) {
                        clearClientTasksCache(userId, dateStr);
                    }
                    try { sessionStorage.setItem('task_save_error', err?.error ?? '削除に失敗しました'); } catch (_) {}
                }
            } catch (_) {
                if (userId && isWithinCurrentMonthRange(taskDate)) {
                    clearClientTasksCache(userId, dateStr);
                }
                try { sessionStorage.setItem('task_save_error', '削除に失敗しました'); } catch (_) {}
            }
        })();
    };

    // 認証前のみ全画面スピナー
    if (!userId) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

    const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

    // 時間形式の検出と変換候補の生成
    const detectTimePattern = (text: string): { pattern: string; converted: string; index: number } | null => {
        // パターン1: 「1425」など（4桁の数字）
        let match = text.match(/\b(\d{4})\b/g);
        if (match) {
            const lastMatch = match[match.length - 1];
            const index = text.lastIndexOf(lastMatch);
            const hour = parseInt(lastMatch.substring(0, 2));
            const minute = parseInt(lastMatch.substring(2, 4));
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                const patternKey = `${index}:${lastMatch}`;
                const isDismissed = Array.from(dismissedPatterns).some(key => key.endsWith(`:${lastMatch}`));
                if (!isDismissed && !dismissedPatterns.has(patternKey)) {
                    return {
                        pattern: lastMatch,
                        converted: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                        index: index
                    };
                }
            }
        }

        // パターン2: 「925」など（3桁の数字）
        match = text.match(/\b(\d{3})\b/g);
        if (match) {
            const lastMatch = match[match.length - 1];
            const index = text.lastIndexOf(lastMatch);
            const hour = parseInt(lastMatch.substring(0, 1));
            const minute = parseInt(lastMatch.substring(1, 3));
            if (hour >= 0 && hour <= 9 && minute >= 0 && minute <= 59) {
                const patternKey = `${index}:${lastMatch}`;
                const isDismissed = Array.from(dismissedPatterns).some(key => key.endsWith(`:${lastMatch}`));
                if (!isDismissed && !dismissedPatterns.has(patternKey)) {
                    return {
                        pattern: lastMatch,
                        converted: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                        index: index
                    };
                }
            }
        }

        // パターン3: 「9:00」など（既に正しい形式）
        match = text.match(/\b(\d{1,2}):(\d{2})\b/g);
        if (match) return null;

        return null;
    };

    const handleTitleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newTitle = e.target.value;
        const previousTitle = title;
        setTitle(newTitle);

        if (timeSuggestion) {
            const existingPattern = timeSuggestion.pattern;
            const existingIndex = timeSuggestion.index;
            const patternEndIndex = existingIndex + existingPattern.length;

            if (newTitle.length < patternEndIndex) {
                setTimeSuggestion(null);
                setTimeSuggestion(detectTimePattern(newTitle));
                return;
            }

            const patternAtPosition = newTitle.substring(existingIndex, patternEndIndex);
            if (patternAtPosition !== existingPattern) {
                setTimeSuggestion(null);
                setTimeSuggestion(detectTimePattern(newTitle));
                return;
            }

            if (newTitle.length > previousTitle.length && newTitle.length > patternEndIndex) {
                const charAfterPattern = newTitle[patternEndIndex];
                if (charAfterPattern && (charAfterPattern === ' ' || charAfterPattern === '\n' || !/\d/.test(charAfterPattern))) {
                    const patternKey = `${existingIndex}:${existingPattern}`;
                    setDismissedPatterns(prev => new Set(prev).add(patternKey));
                    setTimeSuggestion(null);
                    return;
                }
            }
        }

        setTimeSuggestion(detectTimePattern(newTitle));
    };

    const handleTimeSuggestionClick = () => {
        if (timeSuggestion) {
            const before = title.substring(0, timeSuggestion.index);
            const after = title.substring(timeSuggestion.index + timeSuggestion.pattern.length);
            const newTitle = before + timeSuggestion.converted + ' ' + after;
            setTitle(newTitle);
            setTimeSuggestion(null);

            setTimeout(() => {
                if (titleInputRef.current) {
                    const newCursorPosition = timeSuggestion.index + timeSuggestion.converted.length + 1;
                    titleInputRef.current.focus();
                    titleInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
                }
            }, 0);
        }
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.key === ' ' || e.key === 'Enter') && timeSuggestion) {
            e.preventDefault();
            const patternKey = `${timeSuggestion.index}:${timeSuggestion.pattern}`;
            setDismissedPatterns(prev => new Set(prev).add(patternKey));
            setTimeSuggestion(null);
            if (e.key === 'Enter') {
                const before = title.substring(0, timeSuggestion.index + timeSuggestion.pattern.length);
                const after = title.substring(timeSuggestion.index + timeSuggestion.pattern.length);
                setTitle(before + '\n' + after);
            }
        }
    };

    return (
        <div className="min-h-screen bg-base-200">
            {/* 専用ヘッダー */}
            <header className="bg-base-100 shadow-md sticky top-0 z-40">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => {
                            const returnDate = searchParams.get('date');
                            const returnUrl = searchParams.get('returnUrl') || '/top';
                            if (returnDate) {
                                router.push(`${returnUrl}?date=${returnDate}`);
                            } else {
                                router.back();
                            }
                        }}
                        className="btn btn-ghost btn-circle"
                    >
                        <span className="material-icons">arrow_back</span>
                    </button>
                    <h1 className="text-lg font-semibold">タスク編集</h1>
                    <div className="flex gap-2">
                        {taskIdParam && (
                            <button
                                onClick={() => handleDelete()}
                                className="btn btn-ghost btn-circle"
                                disabled={loading}
                            >
                                <span className="material-icons text-error">delete</span>
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            className="btn btn-ghost btn-circle"
                            disabled={loading}
                        >
                            <span className="material-icons">save</span>
                        </button>
                    </div>
                </div>
            </header>

            <div className="container mx-auto px-4 py-6 max-w-2xl">
                {loading && (
                    <div className="flex items-center gap-2 text-base-content/60 mb-4">
                        <span className="loading loading-spinner loading-sm"></span>
                        <span>読み込み中...</span>
                    </div>
                )}
                {/* タイトル入力 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">タイトル</span>
                    </label>
                    <div className="relative">
                        <textarea
                            ref={titleInputRef}
                            placeholder={loading ? '読み込み中...' : 'タスクを入力（Enterで改行）'}
                            disabled={loading}
                            className="textarea textarea-bordered w-full min-h-24 resize-y"
                            rows={3}
                            value={title}
                            onChange={handleTitleChange}
                            onKeyDown={handleTitleKeyDown}
                            autoFocus={!loading && !!userId}
                        />
                        {timeSuggestion && (
                            <div className="absolute right-2 top-2">
                                <button
                                    type="button"
                                    onClick={handleTimeSuggestionClick}
                                    className="btn btn-sm btn-primary btn-outline"
                                >
                                    {timeSuggestion.converted}?
                                </button>
                            </div>
                        )}
                    </div>
                    <p className="text-sm text-base-content/60">
                        900や1425と入力すると9:00、14:25と変換できます
                    </p>
                </div>

                {/* 引継ぎタスク情報 */}
                {isCarryover && dateParam && (
                    <div className="alert alert-warning mb-6">
                        <span className="material-icons">warning</span>
                        <span>
                            {format(parseISO(dateParam), 'M月d日', { locale: ja })}の未完了タスク
                            {completionDate
                                ? ` - ${format(new Date(completionDate), 'M月d日', { locale: ja })}に完了`
                                : 'です'
                            }
                        </span>
                    </div>
                )}

                {/* 期日選択 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">期日</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => setShowDatePicker(true)}
                        className="btn btn-outline w-full justify-start"
                        disabled={loading}
                    >
                        {format(dueDate, 'yyyy年M月d日(E)', { locale: ja })}
                    </button>
                    {showDatePicker && (
                        <DatePicker
                            value={dueDate}
                            onChange={setDueDate}
                            onClose={() => setShowDatePicker(false)}
                        />
                    )}
                </div>

                {/* 通知設定 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">通知設定</span>
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={notificationEnabled}
                            onChange={(e) => setNotificationEnabled(e.target.checked)}
                        />
                    </label>
                    {notificationEnabled && (
                        <div>
                            <input
                                type="time"
                                className="input input-bordered mt-2"
                                value={notificationTime}
                                onChange={handleNotificationTimeChange}
                                onBlur={handleNotificationTimeBlur}
                                step="300"
                            />
                            <label className="label">
                                <span className="label-text-alt text-base-content/60">
                                    通知は5分刻みで送信されます（例: 13:00, 13:05, 13:10...）
                                </span>
                            </label>
                        </div>
                    )}
                </div>

                {/* 繰り返し設定 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">繰り返し設定</span>
                    </label>

                    <div className="space-y-5">
                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'daily'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'daily' ? null : 'daily')}
                            />
                            <span className="label-text mr-4">毎日</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'weekly'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'weekly' ? null : 'weekly')}
                            />
                            <span className="label-text mr-4">毎週</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'monthly'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'monthly' ? null : 'monthly')}
                            />
                            <span className="label-text mr-4">毎月</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'monthly_end'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'monthly_end' ? null : 'monthly_end')}
                            />
                            <span className="label-text mr-4">毎月末</span>
                        </label>

                        <label className="label cursor-pointer justify-start py-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-primary"
                                checked={recurrenceType === 'yearly'}
                                onChange={() => handleRecurrenceChange(recurrenceType === 'yearly' ? null : 'yearly')}
                            />
                            <span className="label-text">毎年</span>
                        </label>

                        <div className="mt-1">
                            <label className="label cursor-pointer justify-start py-3">
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-primary"
                                    checked={recurrenceType === 'weekdays'}
                                    onChange={() => handleRecurrenceChange(recurrenceType === 'weekdays' ? null : 'weekdays')}
                                />
                                <span className="label-text">指定曜日</span>
                            </label>
                            {recurrenceType === 'weekdays' && (
                                <div className="flex flex-wrap gap-2 ml-10 mt-2">
                                    {weekdayLabels.map((label, index) => (
                                        <button
                                            key={index}
                                            onClick={() => handleWeekdayToggle(index)}
                                            className={`btn btn-sm ${selectedWeekdays.includes(index)
                                                ? 'btn-primary'
                                                : 'btn-outline'
                                                }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-1">
                            <label className="label cursor-pointer justify-start py-3">
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-primary"
                                    checked={recurrenceType === 'custom'}
                                    onChange={() => handleRecurrenceChange(recurrenceType === 'custom' ? null : 'custom')}
                                />
                                <span className="label-text">カスタム期間</span>
                            </label>
                            {recurrenceType === 'custom' && (
                                <div className="ml-10 mt-2 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'days'}
                                            onChange={() => setCustomUnit('days')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="日数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'days' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'days') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'days'}
                                        />
                                        <span>日おき</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'weeks'}
                                            onChange={() => setCustomUnit('weeks')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="週数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'weeks' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'weeks') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'weeks'}
                                        />
                                        <span>週おき</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'months'}
                                            onChange={() => setCustomUnit('months')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="月数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'months' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'months') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'months'}
                                        />
                                        <span>ヵ月おき</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'months_end'}
                                            onChange={() => setCustomUnit('months_end')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="月数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'months_end' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'months_end') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'months_end'}
                                        />
                                        <span>ヵ月おきの月末</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="customUnit"
                                            className="radio radio-primary"
                                            checked={customUnit === 'years'}
                                            onChange={() => setCustomUnit('years')}
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="年数"
                                            className="input input-bordered w-20"
                                            value={customUnit === 'years' ? (customDays || '') : ''}
                                            onChange={(e) => {
                                                if (customUnit === 'years') {
                                                    setCustomDays(e.target.value ? parseInt(e.target.value) : null);
                                                }
                                            }}
                                            disabled={customUnit !== 'years'}
                                        />
                                        <span>年おき</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 保存スコープ選択ダイアログ（繰り返し予定の編集時） */}
            {showSaveScopeDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-hidden p-4">
                    <div className="bg-base-100 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4">変更の適用範囲</h2>
                        <p className="mb-6">この予定は繰り返し設定が有効です。変更をどこに適用しますか？</p>

                        <div className="space-y-3 mb-6">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="saveScope"
                                    value="this_only"
                                    defaultChecked
                                    className="radio radio-primary"
                                />
                                <span>この予定のみ変更</span>
                            </label>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="saveScope"
                                    value="all_future"
                                    className="radio radio-primary"
                                />
                                <span>これ以降のすべての繰り返し予定も変更</span>
                            </label>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowSaveScopeDialog(false)}
                                className="btn btn-ghost"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={() => {
                                    const selected = document.querySelector('input[name="saveScope"]:checked') as HTMLInputElement;
                                    if (selected) {
                                        performSave(selected.value as 'this_only' | 'all_future');
                                    }
                                }}
                                className="btn btn-primary"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 削除確認ダイアログ */}
            {showDeleteDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-hidden p-4">
                    <div className="bg-base-100 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4">タスクの削除</h2>
                        {recurrenceType !== null ? (
                            <>
                                <p className="mb-6">このタスクは繰り返し設定が有効です。削除方法を選択してください。</p>

                                <div className="space-y-3 mb-6">
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="deleteOption"
                                            value="this_only"
                                            defaultChecked
                                            className="radio radio-primary"
                                        />
                                        <span>このタスクのみ削除</span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="deleteOption"
                                            value="future_all"
                                            className="radio radio-primary"
                                        />
                                        <span>これ以降の繰り返しタスクすべてを削除</span>
                                    </label>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => { setShowDeleteDialog(false); }}
                                        className="btn btn-ghost"
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        onClick={() => {
                                            const selectedOption = document.querySelector('input[name="deleteOption"]:checked') as HTMLInputElement;
                                            if (selectedOption) {
                                                handleDelete(selectedOption.value as 'this_only' | 'future_all');
                                            }
                                        }}
                                        className="btn btn-error"
                                    >
                                        削除
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="mb-6">このタスクを削除してもよろしいですか？</p>

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => { setShowDeleteDialog(false); }}
                                        className="btn btn-ghost"
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        onClick={() => { handleDelete('this_only'); }}
                                        className="btn btn-error"
                                    >
                                        削除
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function TaskEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        }>
            <TaskEditPageContent />
        </Suspense>
    );
}
