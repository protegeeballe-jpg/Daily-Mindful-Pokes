import test from 'node:test';
import assert from 'node:assert/strict';
import { installVaultSyncRefresh } from '../assets/vault-refresh.js';

class FakeEventTarget {
    listeners = new Map();
    nextIntervalId = 1;
    intervals = new Map();

    addEventListener(type, listener) {
        const group = this.listeners.get(type) || new Set();
        group.add(listener);
        this.listeners.set(type, group);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type) {
        for (const listener of this.listeners.get(type) || []) listener();
    }

    setInterval(callback, delay) {
        const id = this.nextIntervalId++;
        this.intervals.set(id, { callback, delay });
        return id;
    }

    clearInterval(id) {
        this.intervals.delete(id);
    }

    tickIntervals() {
        for (const interval of this.intervals.values()) interval.callback();
    }
}

test('refreshes the vault on foreground events and while visible', async () => {
    const windowRef = new FakeEventTarget();
    const documentRef = new FakeEventTarget();
    documentRef.visibilityState = 'visible';
    let refreshCount = 0;

    const cleanup = installVaultSyncRefresh({
        windowRef,
        documentRef,
        refresh: () => { refreshCount += 1; },
        intervalMs: 30_000
    });

    assert.deepEqual([...windowRef.intervals.values()].map(item => item.delay), [30_000]);
    windowRef.dispatch('focus');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(refreshCount, 1);

    windowRef.dispatch('pageshow');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(refreshCount, 2);

    documentRef.dispatch('visibilitychange');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(refreshCount, 3);

    windowRef.tickIntervals();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(refreshCount, 4);

    cleanup();
    assert.equal(windowRef.intervals.size, 0);
    windowRef.dispatch('focus');
    await Promise.resolve();
    assert.equal(refreshCount, 4);
});

test('does not refresh while hidden or when the caller has disabled refresh', async () => {
    const windowRef = new FakeEventTarget();
    const documentRef = new FakeEventTarget();
    documentRef.visibilityState = 'hidden';
    let allowed = true;
    let refreshCount = 0;

    const cleanup = installVaultSyncRefresh({
        windowRef,
        documentRef,
        refresh: () => { refreshCount += 1; },
        canRefresh: () => allowed
    });

    windowRef.dispatch('focus');
    documentRef.dispatch('visibilitychange');
    windowRef.tickIntervals();
    await Promise.resolve();
    assert.equal(refreshCount, 0);

    documentRef.visibilityState = 'visible';
    allowed = false;
    windowRef.dispatch('pageshow');
    windowRef.tickIntervals();
    await Promise.resolve();
    assert.equal(refreshCount, 0);

    cleanup();
});

test('coalesces overlapping foreground events into one refresh', async () => {
    const windowRef = new FakeEventTarget();
    const documentRef = new FakeEventTarget();
    documentRef.visibilityState = 'visible';
    let releaseRefresh;
    let refreshCount = 0;

    const cleanup = installVaultSyncRefresh({
        windowRef,
        documentRef,
        refresh: () => {
            refreshCount += 1;
            return new Promise(resolve => { releaseRefresh = resolve; });
        }
    });

    windowRef.dispatch('focus');
    windowRef.dispatch('pageshow');
    documentRef.dispatch('visibilitychange');
    await Promise.resolve();
    assert.equal(refreshCount, 1);

    releaseRefresh();
    await Promise.resolve();
    await Promise.resolve();

    windowRef.dispatch('focus');
    await Promise.resolve();
    assert.equal(refreshCount, 2);
    cleanup();
});
