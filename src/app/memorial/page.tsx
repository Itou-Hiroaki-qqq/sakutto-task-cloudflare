'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import DatePicker from '@/components/DatePicker';

function MemorialEditPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [userId, setUserId] = useState<string | null>(null);

    // URLパラメータから取得
    const memorialIdParam = searchParams.get('memorialId');
    const dateParam = searchParams.get('date');
    const initialDate = dateParam ? parseISO(dateParam) : new Date();

    // フォーム状態
    const [title, setTitle] = useState('');
    const [timeSuggestion, setTimeSuggestion] = useState<{ pattern: string; converted: string; index: number } | null>(null);
    const [dismissedPatterns, setDismissedPatterns] = useState<Set<string>>(new Set());
    const titleInputRef = useRef<HTMLInputElement>(null);
    const [dueDate, setDueDate] = useState(initialDate);
    const [notificationEnabled, setNotificationEnabled] = useState(false);
    const [notificationTime, setNotificationTime] = useState('');
    const [yearlyEnabled, setYearlyEnabled] = useState(false);
    const [isHoliday, setIsHoliday] = useState(false);

    const [showDatePicker, setShowDatePicker] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [memorialList, setMemorialList] = useState<Array<{ id: string; title: string; due_date: Date; recurrence_type: string | null }>>([]);
    const [loadingMemorialList, setLoadingMemorialList] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
            const res = await fetch('/api/auth/me');
            if (!res.ok) { router.push('/login'); return; }
            const { user } = await res.json() as any;
            setUserId(user.id);

            // 既存記念日を編集する場合
            if (memorialIdParam) {
                const dateParam = searchParams.get('date');
                loadMemorial(memorialIdParam, user.id, dateParam);
            } else {
                // 新規記念日作成時は、URLパラメータの日付を使用
                const newDateParam = searchParams.get('date');
                if (newDateParam) {
                    try {
                        const parsedDate = parseISO(newDateParam);
                        setDueDate(parsedDate);
                    } catch (e) {
                        // パースエラーは無視
                    }
                }
            }
        };

        checkAuth();
    }, [router, memorialIdParam, searchParams]);

    useEffect(() => {
        if (userId) {
            loadMemorialList();
        }
    }, [userId]);

    // URLパラメータが変わった時（編集モードからリストモードに戻った時など）にフォームをリセット
    useEffect(() => {
        if (!memorialIdParam) {
            setTitle('');
            setDueDate(initialDate);
            setNotificationEnabled(false);
            setNotificationTime('');
            setYearlyEnabled(false);
            setIsHoliday(false);
            if (userId) {
                loadMemorialList();
            }
        }
    }, [memorialIdParam, userId]);

    const loadMemorial = async (memorialId: string, userId: string, dateParam?: string | null) => {
        setLoading(true);
        try {
            const response = await fetch(`/api/memorials/${memorialId}`);

            if (response.ok) {
                const data = await response.json() as any;

                if (!data.memorial) {
                    alert('記念日データが見つかりませんでした');
                    router.back();
                    return;
                }
                setTitle(data.memorial.title || '');

                // 期日の設定: URLパラメータの日付がある場合はそれを使用、なければ記念日の期日を使用
                if (dateParam) {
                    try {
                        const parsedDate = parseISO(dateParam);
                        setDueDate(parsedDate);
                    } catch (e) {
                        setDueDate(data.memorial.due_date ? new Date(data.memorial.due_date) : initialDate);
                    }
                } else {
                    setDueDate(data.memorial.due_date ? new Date(data.memorial.due_date) : initialDate);
                }

                setNotificationEnabled(data.memorial.notification_enabled || false);
                setNotificationTime(data.memorial.notification_time || '');
                setIsHoliday(data.memorial.is_holiday || false);

                // 繰り返し設定がyearlyの場合のみ、毎年設定を有効にする
                setYearlyEnabled(data.memorial.recurrence?.type === 'yearly' || false);
            } else {
                const errorData = await response.json() as any;
                if (response.status === 404) {
                    alert('記念日が見つかりませんでした。既に削除されている可能性があります。');
                    router.back();
                } else {
                    alert(`記念日の読み込みに失敗しました: ${errorData.error || 'Unknown error'}`);
                }
            }
        } catch (error) {
            console.error('Failed to load memorial:', error);
            alert('記念日の読み込み中にエラーが発生しました');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!title.trim() || !userId) {
            alert('タイトルを入力してください');
            return;
        }

        // 通知設定が有効な場合、メールアドレスの設定確認
        if (notificationEnabled && notificationTime) {
            try {
                const settingsResponse = await fetch('/api/settings/notifications');
                if (settingsResponse.ok) {
                    const settingsData = await settingsResponse.json() as any;
                    const hasEmail = settingsData.settings?.email && settingsData.settings?.email_notification_enabled;

                    if (!hasEmail) {
                        const returnDate = searchParams.get('date');
                        const returnUrl = `/memorial${memorialIdParam ? `?memorialId=${memorialIdParam}` : ''}${returnDate ? `&date=${returnDate}` : ''}`;
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

        setSaving(true);
        try {
            const payload = {
                memorialId: memorialIdParam,
                title: title.trim(),
                dueDate: format(dueDate, 'yyyy-MM-dd'),
                notificationEnabled,
                notificationTime: notificationEnabled ? notificationTime : null,
                yearlyEnabled,
                isHoliday,
            };

            const response = await fetch('/api/memorials', {
                method: memorialIdParam ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (response.ok) {
                setTitle('');
                setDueDate(initialDate);
                setNotificationEnabled(false);
                setNotificationTime('');
                setYearlyEnabled(false);
                setIsHoliday(false);
                await loadMemorialList();
                router.push('/memorial');
            } else {
                const error = await response.json() as any;
                console.error('Save error:', error);
                alert(error.error || '保存に失敗しました。データベーススキーマが最新か確認してください。');
            }
        } catch (error) {
            console.error('Failed to save memorial:', error);
            alert('保存に失敗しました');
        } finally {
            setSaving(false);
        }
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

    const loadMemorialList = async () => {
        if (!userId) return;
        setLoadingMemorialList(true);
        try {
            const response = await fetch('/api/memorials');
            if (response.ok) {
                const data = await response.json() as any;
                setMemorialList(data.memorials || []);
            }
        } catch (error) {
            console.error('Failed to load memorial list:', error);
        } finally {
            setLoadingMemorialList(false);
        }
    };

    const handleDelete = async (memorialId: string) => {
        if (!confirm('この記念日を削除してもよろしいですか？')) {
            return;
        }

        setDeleting(true);
        try {
            const response = await fetch(`/api/memorials/${memorialId}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                loadMemorialList();
                if (memorialId === memorialIdParam) {
                    router.push('/memorial');
                }
            } else {
                const error = await response.json() as any;
                console.error('Delete error:', error);
                alert(error.error || '削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete memorial:', error);
            alert('削除に失敗しました');
        } finally {
            setDeleting(false);
        }
    };

    if (!userId || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

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

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if ((e.key === ' ' || e.key === 'Enter') && timeSuggestion) {
            const patternKey = `${timeSuggestion.index}:${timeSuggestion.pattern}`;
            setDismissedPatterns(prev => new Set(prev).add(patternKey));
            setTimeSuggestion(null);
        }
    };

    return (
        <div className="min-h-screen bg-base-200">
            {/* 専用ヘッダー */}
            <header className="bg-base-100 shadow-md sticky top-0 z-40">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={() => { router.push('/top'); }}
                        className="btn btn-ghost btn-circle"
                    >
                        <span className="material-icons">arrow_back</span>
                    </button>
                    <h1 className="text-lg font-semibold">記念日設定</h1>
                    <div className="flex gap-2">
                        {memorialIdParam && (
                            <button
                                onClick={() => handleDelete(memorialIdParam)}
                                className="btn btn-ghost btn-circle"
                                disabled={deleting}
                            >
                                {deleting ? (
                                    <span className="loading loading-spinner loading-sm"></span>
                                ) : (
                                    <span className="material-icons text-error">delete</span>
                                )}
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            className="btn btn-ghost btn-circle"
                            disabled={saving}
                        >
                            {saving ? (
                                <span className="loading loading-spinner loading-sm"></span>
                            ) : (
                                <span className="material-icons">save</span>
                            )}
                        </button>
                    </div>
                </div>
            </header>

            <div className="container mx-auto px-4 py-6 max-w-2xl">
                {/* タイトル入力 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">タイトル</span>
                    </label>
                    <div className="relative">
                        <input
                            ref={titleInputRef}
                            type="text"
                            placeholder="記念日を入力"
                            className="input input-bordered w-full"
                            value={title}
                            onChange={handleTitleChange}
                            onKeyDown={handleTitleKeyDown}
                        />
                        {timeSuggestion && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2">
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

                {/* 期日選択 */}
                <div className="form-control mb-6">
                    <label className="label">
                        <span className="label-text font-semibold">期日</span>
                    </label>
                    <button
                        onClick={() => setShowDatePicker(true)}
                        className="btn btn-outline w-full justify-start"
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

                {/* 毎年設定 */}
                <div className="form-control mb-6">
                    <label className="label cursor-pointer justify-start">
                        <span className="label-text font-semibold">毎年設定する</span>
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={yearlyEnabled}
                            onChange={(e) => setYearlyEnabled(e.target.checked)}
                        />
                    </label>
                </div>

                {/* 祝日設定 */}
                <div className="form-control mb-6">
                    <label className="label cursor-pointer justify-start">
                        <span className="label-text font-semibold">祝日として設定する</span>
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={isHoliday}
                            onChange={(e) => setIsHoliday(e.target.checked)}
                        />
                    </label>
                    <p className="text-sm text-base-content/60">
                        チェックを入れると、カレンダー上でその日付が赤く表示されます
                    </p>
                </div>

                {/* 登録済みの記念日 */}
                {!memorialIdParam && (
                    <div className="form-control mb-6">
                        <label className="label">
                            <span className="label-text font-semibold">登録済みの記念日</span>
                        </label>
                        {loadingMemorialList ? (
                            <div className="flex justify-center py-4">
                                <span className="loading loading-spinner"></span>
                            </div>
                        ) : memorialList.length === 0 ? (
                            <div className="text-center text-base-content/50 py-4">
                                登録済みの記念日はありません
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {memorialList.map((memorial) => (
                                    <div key={memorial.id} className="flex items-center justify-between p-3 bg-base-100 rounded-lg shadow hover:shadow-md transition-shadow">
                                        <button
                                            onClick={() => router.push(`/memorial?memorialId=${memorial.id}`)}
                                            className="flex-1 text-left min-w-0"
                                        >
                                            <div className="flex items-start gap-2 min-w-0">
                                                <span className="text-sm text-base-content/60 shrink-0">
                                                    {memorial.recurrence_type === 'yearly'
                                                        ? format(memorial.due_date, 'M月d日', { locale: ja })
                                                        : format(memorial.due_date, 'yyyy年M月d日', { locale: ja })}
                                                </span>
                                                <span className="flex-1 min-w-0 wrap-break-word">{memorial.title}</span>
                                                {memorial.recurrence_type && (
                                                    <span className="badge badge-sm badge-outline shrink-0">毎年</span>
                                                )}
                                            </div>
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(memorial.id);
                                            }}
                                            className="btn btn-ghost btn-sm btn-circle"
                                            disabled={deleting}
                                        >
                                            <span className="material-icons text-error text-lg">delete</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function MemorialEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        }>
            <MemorialEditPageContent />
        </Suspense>
    );
}
