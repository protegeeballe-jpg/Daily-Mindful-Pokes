/**
 * Refresh a shared vault when the app returns to the foreground and while it
 * remains visible. A single in-flight refresh is shared by overlapping events.
 */
export function installVaultSyncRefresh({
  windowRef,
  documentRef,
  refresh,
  canRefresh = () => true,
  intervalMs = 30_000
} = {}) {
  if (typeof refresh !== 'function'
      || typeof windowRef?.addEventListener !== 'function'
      || typeof documentRef?.addEventListener !== 'function'
      || typeof windowRef?.setInterval !== 'function'
      || typeof windowRef?.clearInterval !== 'function') {
    return () => {};
  }

  let disposed = false;
  let inFlight = null;

  const refreshIfReady = () => {
    if (disposed || documentRef.visibilityState !== 'visible' || !canRefresh()) return;
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => refresh())
      .catch(() => {
        // The caller owns status reporting; a failed background refresh must
        // not create an unhandled rejection or disturb locally saved packets.
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  windowRef.addEventListener('focus', refreshIfReady);
  windowRef.addEventListener('pageshow', refreshIfReady);
  documentRef.addEventListener('visibilitychange', refreshIfReady);
  const intervalId = windowRef.setInterval(refreshIfReady, intervalMs);

  return () => {
    if (disposed) return;
    disposed = true;
    windowRef.removeEventListener?.('focus', refreshIfReady);
    windowRef.removeEventListener?.('pageshow', refreshIfReady);
    documentRef.removeEventListener?.('visibilitychange', refreshIfReady);
    windowRef.clearInterval(intervalId);
  };
}
