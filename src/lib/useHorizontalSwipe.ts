'use client';

import { useCallback, useRef } from 'react';

interface Options {
    onSwipeRight?: () => void;
    onSwipeLeft?: () => void;
    /** 横移動の最低距離(px) */
    threshold?: number;
    /** マウス操作のとき、この要素から始まったドラッグはスワイプとして扱わない（文字選択と競合するため） */
    ignoreMouseSelector?: string;
}

/**
 * 指(またはマウス)の左右ドラッグを検出する。縦スクロールは邪魔しない
 * （対象要素に touch-pan-y を付けること）。
 * スワイプ成立直後の click は打ち消し、リンクや入力欄が誤作動しないようにする。
 */
export function useHorizontalSwipe({
    onSwipeRight,
    onSwipeLeft,
    threshold = 70,
    ignoreMouseSelector,
}: Options) {
    const handlersRef = useRef({ onSwipeRight, onSwipeLeft });
    handlersRef.current = { onSwipeRight, onSwipeLeft };

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (
            e.pointerType === 'mouse' &&
            ignoreMouseSelector &&
            (e.target as Element).closest(ignoreMouseSelector)
        ) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;

        const cleanup = () => {
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', cleanup);
        };

        const onUp = (ev: PointerEvent) => {
            if (ev.pointerId !== pointerId) return;
            cleanup();
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;

            const handler = dx > 0 ? handlersRef.current.onSwipeRight : handlersRef.current.onSwipeLeft;
            if (!handler) return;

            // 直後に発火する click を1回だけ打ち消す
            const swallow = (ce: Event) => {
                ce.preventDefault();
                ce.stopPropagation();
            };
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 100);

            handler();
        };

        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', cleanup);
    }, [threshold, ignoreMouseSelector]);

    return { onPointerDown };
}
