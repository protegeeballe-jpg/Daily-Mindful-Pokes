import test from 'node:test';
import assert from 'node:assert/strict';
import { installDeviceClockRefresh } from '../assets/device-clock.js';

class FakeEventTarget {
    listeners = new Map();

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
}

test('refreshes the device date when the app becomes visible or regains focus', () => {
    const windowRef = new FakeEventTarget();
    const documentRef = new FakeEventTarget();
    documentRef.visibilityState = 'hidden';
    let refreshCount = 0;

    const cleanup = installDeviceClockRefresh({
        windowRef,
        documentRef,
        refresh: () => { refreshCount += 1; }
    });

    windowRef.dispatch('focus');
    windowRef.dispatch('pageshow');
    assert.equal(refreshCount, 0, 'hidden app should not refresh from focus-like events');

    documentRef.visibilityState = 'visible';
    documentRef.dispatch('visibilitychange');
    assert.equal(refreshCount, 1);

    windowRef.dispatch('pageshow');
    assert.equal(refreshCount, 2);

    windowRef.dispatch('focus');
    assert.equal(refreshCount, 3);

    documentRef.visibilityState = 'hidden';
    documentRef.dispatch('visibilitychange');
    assert.equal(refreshCount, 3, 'background transition should not refresh');

    cleanup();
    documentRef.visibilityState = 'visible';
    documentRef.dispatch('visibilitychange');
    windowRef.dispatch('focus');
    assert.equal(refreshCount, 3, 'cleanup should remove all listeners');
});

test('returns a safe no-op cleanup when required inputs are unavailable', () => {
    assert.doesNotThrow(() => installDeviceClockRefresh()());
    assert.doesNotThrow(() => installDeviceClockRefresh({
        windowRef: new FakeEventTarget(),
        documentRef: new FakeEventTarget(),
        refresh: null
    })());
});
