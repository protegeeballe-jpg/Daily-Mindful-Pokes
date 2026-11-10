import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LOCATION_CHECKIN_OPTIONS,
    getLocationCheckinStorageKey,
    loadLocationCheckins,
    saveLocationCheckin
} from '../assets/location-checkin.js';

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        values
    };
}

function position(latitude, longitude, accuracy = 18.5, timestamp = 1794312000000) {
    return { coords: { latitude, longitude, accuracy }, timestamp };
}

test('the four existing checklist location options remain supported', () => {
    assert.deepEqual(Object.keys(LOCATION_CHECKIN_OPTIONS), [
        'loc-home', 'loc-office', 'loc-house', 'loc-out'
    ]);
    assert.equal(LOCATION_CHECKIN_OPTIONS['loc-home'], 'AT HOME');
    assert.equal(LOCATION_CHECKIN_OPTIONS['loc-office'], 'AT WORK');
});

test('location coordinates are saved per selected date and checkbox without changing other entries', () => {
    const storage = createStorage();
    const key = getLocationCheckinStorageKey('2026-11-10');

    saveLocationCheckin(storage, '2026-11-10', 'loc-home', position(14.599512, 120.984222));
    saveLocationCheckin(storage, '2026-11-10', 'loc-office', position(14.554729, 121.024445, 9.2));

    const records = loadLocationCheckins(storage, '2026-11-10');
    assert.equal(records['loc-home'].latitude, 14.599512);
    assert.equal(records['loc-home'].longitude, 120.984222);
    assert.equal(records['loc-home'].accuracyMeters, 18.5);
    assert.equal(records['loc-office'].accuracyMeters, 9.2);
    assert.equal(records['loc-home'].capturedAt, new Date(1794312000000).toISOString());
    assert.equal(storage.values.has(key), true);
    assert.deepEqual(loadLocationCheckins(storage, '2026-11-11'), {});
});

test('location storage uses a separate key and validates checklist dates', () => {
    assert.equal(
        getLocationCheckinStorageKey('2026-11-10'),
        'faith_focus_location_checkins_v1_2026-11-10'
    );
    assert.throws(() => getLocationCheckinStorageKey('2026-02-30'), /valid checklist date/);
    assert.throws(() => getLocationCheckinStorageKey('not-a-date'), /valid checklist date/);
});

test('invalid location IDs and out-of-range coordinates are rejected without saving', () => {
    const storage = createStorage();
    assert.throws(() => saveLocationCheckin(storage, '2026-11-10', 'loc-unknown', position(14, 120)));
    assert.throws(() => saveLocationCheckin(storage, '2026-11-10', 'loc-home', position(91, 120)));
    assert.throws(() => saveLocationCheckin(storage, '2026-11-10', 'loc-home', position(14, 181)));
    assert.equal(storage.values.size, 0);
});

test('unticking a location clears only that location record', async () => {
    const storage = createStorage();
    saveLocationCheckin(storage, '2026-11-10', 'loc-home', position(14.5, 120.9));
    saveLocationCheckin(storage, '2026-11-10', 'loc-office', position(14.6, 121.0));

    const { removeLocationCheckin } = await import('../assets/location-checkin.js');
    removeLocationCheckin(storage, '2026-11-10', 'loc-home');

    const records = loadLocationCheckins(storage, '2026-11-10');
    assert.equal(records['loc-home'], undefined);
    assert.ok(records['loc-office']);
});

test('damaged stored data is ignored and only valid location records are loaded', () => {
    const storage = createStorage();
    const key = getLocationCheckinStorageKey('2026-11-10');
    storage.setItem(key, JSON.stringify({
        'loc-home': {
            latitude: 14.5,
            longitude: 120.9,
            accuracyMeters: 12,
            capturedAt: '2026-11-10T12:00:00.000Z'
        },
        'loc-office': { latitude: 200, longitude: 120, accuracyMeters: 5, capturedAt: 'invalid' },
        extra: { latitude: 14, longitude: 120, accuracyMeters: 4, capturedAt: '2026-11-10T12:00:00.000Z' }
    }));
    const records = loadLocationCheckins(storage, '2026-11-10');
    assert.deepEqual(Object.keys(records), ['loc-home']);
});
