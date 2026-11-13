export function installDeviceClockRefresh({ windowRef, documentRef, refresh } = {}) {
    if (typeof refresh !== 'function'
        || typeof windowRef?.addEventListener !== 'function'
        || typeof documentRef?.addEventListener !== 'function') {
        return () => {};
    }

    const refreshWhenVisible = () => {
        if (documentRef.visibilityState === 'visible') refresh();
    };

    windowRef.addEventListener('focus', refreshWhenVisible);
    windowRef.addEventListener('pageshow', refreshWhenVisible);
    documentRef.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
        windowRef.removeEventListener?.('focus', refreshWhenVisible);
        windowRef.removeEventListener?.('pageshow', refreshWhenVisible);
        documentRef.removeEventListener?.('visibilitychange', refreshWhenVisible);
    };
}
