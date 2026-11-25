'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { format } from 'date-fns';
import DatePicker from './DatePicker';
import { useHorizontalSwipe } from '@/lib/useHorizontalSwipe';
import { MEMO_MAX_LENGTH } from '@/lib/memos';

interface Memo {
    id: string;
    content: string;
    created_at: string;
}

type Toast =
    | { kind: 'undo'; memo: Memo }
    | { kind: 'info' | 'error'; text: string };

export interface MemoPanelHandle {
    /** 新規入力欄にフォーカスする（スワイプ操作の中で同期的に呼ぶとスマホでもキーボードが出る） */
    focusNew: () => void;
}

interface MemoPanelProps {
    open: boolean;
    onClose: () => void;
    /** 「タスクに移動」の日付ピッカーの初期値 */
    selectedDate: Date;
    /** メモをタスクに移動した後に呼ぶ（画面のタスク一覧を再取得するため） */
    onMoved: (dateStr: string) => void;
    ref?: React.Ref<MemoPanelHandle>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export default function MemoPanel({ open, onClose, selectedDate, onMoved, ref }: MemoPanelProps) {
    const [memos, setMemos] = useState<Memo[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [newText, setNewText] = useState('');
    const [toast, setToast] = useState<Toast | null>(null);
    const [moving, setMoving] = useState<Memo | null>(null);

    const newRef = useRef<HTMLTextAreaElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
        focusNew: () => newRef.current?.focus({ preventScroll: true }),
    }), []);

    const showToast = useCallback((t: Toast, ms = 3000) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(t);
        toastTimer.current = setTimeout(() => setToast(null), ms);
    }, []);

    useEffect(() => () => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
    }, []);

    const scrollToBottom = useCallback(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    // 開くたびに最新を取得（別の端末での変更も反映）
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/memos');
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json() as { memos: Memo[] };
                if (!cancelled) setMemos(data.memos);
            } catch (e) {
                console.error('Failed to load memos:', e);
                if (!cancelled) showToast({ kind: 'error', text: 'メモを読み込めませんでした' });
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [open, showToast]);

    // メモが増減・読み込まれたら一番下へ（新規入力行が見える位置）
    useEffect(() => {
        if (open) scrollToBottom();
    }, [open, loaded, memos.length, scrollToBottom]);

    // Escで閉じる
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !moving) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose, moving]);

    const swipe = useHorizontalSwipe({
        onSwipeRight: onClose,
        ignoreMouseSelector: 'textarea',
    });

    const addMemo = async () => {
        const content = newText.trim();
        if (!content) return;
        if (content.length > MEMO_MAX_LENGTH) {
            showToast({ kind: 'error', text: `${MEMO_MAX_LENGTH}文字以内で入力してください` });
            return;
        }
        const memo: Memo = { id: crypto.randomUUID(), content, created_at: new Date().toISOString() };
        setMemos((prev) => [...prev, memo]);
        setNewText('');
        try {
            const res = await fetch('/api/memos', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ id: memo.id, content: memo.content, createdAt: memo.created_at }),
            });
            if (!res.ok) throw new Error(String(res.status));
        } catch (e) {
            console.error('Failed to add memo:', e);
            setMemos((prev) => prev.filter((m) => m.id !== memo.id));
            setNewText(content);
            showToast({ kind: 'error', text: 'メモを保存できませんでした' });
        }
    };

    const updateMemo = async (id: string, content: string) => {
        const before = memos.find((m) => m.id === id);
        if (!before) return;
        setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
        try {
            const res = await fetch(`/api/memos/${id}`, {
                method: 'PUT',
                headers: JSON_HEADERS,
                body: JSON.stringify({ content }),
            });
            if (!res.ok) throw new Error(String(res.status));
        } catch (e) {
            console.error('Failed to update memo:', e);
            setMemos((prev) => prev.map((m) => (m.id === id ? before : m)));
            showToast({ kind: 'error', text: 'メモを更新できませんでした' });
        }
    };

    const insertSorted = (prev: Memo[], memo: Memo) =>
        [...prev, memo].sort((a, b) => a.created_at.localeCompare(b.created_at));

    const deleteMemo = async (memo: Memo) => {
        setMemos((prev) => prev.filter((m) => m.id !== memo.id));
        showToast({ kind: 'undo', memo }, 5000);
        try {
            const res = await fetch(`/api/memos/${memo.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(String(res.status));
        } catch (e) {
            console.error('Failed to delete memo:', e);
            setMemos((prev) => insertSorted(prev, memo));
            showToast({ kind: 'error', text: 'メモを削除できませんでした' });
        }
    };

    const undoDelete = async (memo: Memo) => {
        setToast(null);
        setMemos((prev) => insertSorted(prev, memo));
        try {
            const res = await fetch('/api/memos', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ id: memo.id, content: memo.content, createdAt: memo.created_at }),
            });
            if (!res.ok) throw new Error(String(res.status));
        } catch (e) {
            console.error('Failed to restore memo:', e);
            setMemos((prev) => prev.filter((m) => m.id !== memo.id));
            showToast({ kind: 'error', text: '元に戻せませんでした' });
        }
    };

    const moveToTask = async (memo: Memo, date: Date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        try {
            const res = await fetch(`/api/memos/${memo.id}/move`, {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ dueDate: dateStr }),
            });
            if (!res.ok) throw new Error(String(res.status));
            setMemos((prev) => prev.filter((m) => m.id !== memo.id));
            showToast({ kind: 'info', text: `${format(date, 'M月d日')}のタスクに移動しました` });
            onMoved(dateStr);
        } catch (e) {
            console.error('Failed to move memo:', e);
            showToast({ kind: 'error', text: 'タスクに移動できませんでした' });
        }
    };

    const tab = open ? 0 : -1;

    return (
        <>
            <div
                {...swipe}
                aria-hidden={!open}
                className={`fixed inset-0 z-[55] flex flex-col bg-base-200 touch-pan-y transition-transform duration-300 ease-out ${
                    open ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between bg-base-100 px-4 py-3 shadow pt-[max(0.75rem,env(safe-area-inset-top))]">
                    <h2 className="text-lg font-bold">なんでもメモ</h2>
                    <span className="text-xs text-base-content/50">右へスワイプで戻る →</span>
                </div>

                <div ref={listRef} className="flex-1 overflow-y-auto touch-pan-y px-4 py-4 space-y-2">
                    {memos.map((memo) => (
                        <MemoRow
                            key={memo.id}
                            memo={memo}
                            tabIndex={tab}
                            onSave={updateMemo}
                            onDelete={deleteMemo}
                            onMove={setMoving}
                            onEnter={() => newRef.current?.focus({ preventScroll: true })}
                        />
                    ))}

                    <div className="flex items-start gap-2 p-3 rounded-lg bg-base-100 shadow touch-pan-y">
                        <AutoTextarea
                            ref={newRef}
                            value={newText}
                            onChange={setNewText}
                            onEnter={addMemo}
                            placeholder="メモを書く（Enterで確定）"
                            tabIndex={tab}
                            maxLength={MEMO_MAX_LENGTH}
                        />
                    </div>
                    {/* キーボードで隠れないよう下に余白を確保 */}
                    <div className="h-[40vh]" aria-hidden />
                </div>

                {toast && (
                    <div className="absolute bottom-4 left-4 right-4 z-10">
                        <div className={`alert shadow-lg ${toast.kind === 'error' ? 'alert-error' : 'alert-neutral'}`}>
                            {toast.kind === 'undo' ? (
                                <>
                                    <span>メモを削除しました</span>
                                    <button className="btn btn-sm" tabIndex={tab} onClick={() => undoDelete(toast.memo)}>
                                        元に戻す
                                    </button>
                                </>
                            ) : (
                                <span>{toast.text}</span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {moving && (
                <div className="relative z-[70]">
                    <DatePicker
                        value={selectedDate}
                        onChange={(date) => { void moveToTask(moving, date); }}
                        onClose={() => setMoving(null)}
                    />
                </div>
            )}
        </>
    );
}

function MemoRow({
    memo,
    tabIndex,
    onSave,
    onDelete,
    onMove,
    onEnter,
}: {
    memo: Memo;
    tabIndex: number;
    onSave: (id: string, content: string) => void;
    onDelete: (memo: Memo) => void;
    onMove: (memo: Memo) => void;
    onEnter: () => void;
}) {
    const [text, setText] = useState(memo.content);

    useEffect(() => { setText(memo.content); }, [memo.content]);

    const commit = () => {
        const trimmed = text.trim();
        if (!trimmed || trimmed.length > MEMO_MAX_LENGTH) {
            setText(memo.content);
            return;
        }
        if (trimmed !== memo.content) onSave(memo.id, trimmed);
        else setText(memo.content);
    };

    return (
        <div className="flex items-start gap-1 p-3 rounded-lg bg-base-100 shadow touch-pan-y">
            <AutoTextarea
                value={text}
                onChange={setText}
                onBlur={commit}
                onEnter={onEnter}
                tabIndex={tabIndex}
                maxLength={MEMO_MAX_LENGTH}
            />
            <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle shrink-0"
                title="タスクに移動"
                aria-label="タスクに移動"
                tabIndex={tabIndex}
                onClick={() => onMove(memo)}
            >
                <span className="material-icons text-primary">event</span>
            </button>
            <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle shrink-0"
                title="削除"
                aria-label="削除"
                tabIndex={tabIndex}
                onClick={() => onDelete(memo)}
            >
                <span className="material-icons text-error">delete</span>
            </button>
        </div>
    );
}

/** 内容に合わせて高さが伸びる入力欄。Enterは改行ではなく「確定」（1行=1メモ） */
function AutoTextarea({
    value,
    onChange,
    onEnter,
    onBlur,
    placeholder,
    tabIndex,
    maxLength,
    ref,
}: {
    value: string;
    onChange: (v: string) => void;
    onEnter: () => void;
    onBlur?: () => void;
    placeholder?: string;
    tabIndex?: number;
    maxLength?: number;
    ref?: React.Ref<HTMLTextAreaElement>;
}) {
    const inner = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        const el = inner.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    return (
        <textarea
            ref={(el) => {
                inner.current = el;
                if (typeof ref === 'function') ref(el);
                else if (ref) ref.current = el;
            }}
            rows={1}
            value={value}
            placeholder={placeholder}
            tabIndex={tabIndex}
            maxLength={maxLength}
            enterKeyHint="done"
            className="flex-1 min-w-0 resize-none bg-transparent outline-none py-1 leading-relaxed touch-pan-y"
            onChange={(e) => onChange(e.target.value.replace(/\n/g, ''))}
            onBlur={onBlur}
            onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (onBlur) (e.target as HTMLTextAreaElement).blur();
                onEnter();
            }}
        />
    );
}
