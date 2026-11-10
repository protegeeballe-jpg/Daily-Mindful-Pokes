export const LOCATION_CHECKIN_STORAGE_PREFIX = 'faith_focus_location_checkins_v1_';

export const LOCATION_CHECKIN_OPTIONS = Object.freeze({
    'loc-home': 'AT HOME',
    'loc-office': 'AT WORK',
    'loc-house': "AT SOMEONE ELSE'S HOUSE",
    'loc-out': 'OUT HERE. SOMEWHERE'
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function getLocationCheckinStorageKey(dateString) {
    if (!isValidDateString(dateString)) {
        throw new TypeError('A valid checklist date is required for a location check-in.');
    }
    return LOCATION_CHECKIN_STORAGE_PREFIX + dateString;
}

function isValidRecord(record) {
    return !!record
        && Number.isFinite(record.latitude)
        && record.latitude >= -90
        && record.latitude <= 90
        && Number.isFinite(record.longitude)
        && record.longitude >= -180
        && record.longitude <= 180
        && Number.isFinite(record.accuracyMeters)
        && record.accuracyMeters >= 0
        && typeof record.capturedAt === 'string'
        && Number.isFinite(Date.parse(record.capturedAt));
}

export function loadLocationCheckins(storage, dateString) {
    const key = getLocationCheckinStorageKey(dateString);
    let raw;
    try {
        raw = storage.getItem(key);
    } catch (error) {
        return {};
    }
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return Object.fromEntries(
            Object.entries(parsed).filter(([id, record]) =>
                Object.hasOwn(LOCATION_CHECKIN_OPTIONS, id) && isValidRecord(record)
            )
        );
    } catch (error) {
        return {};
    }
}

export function removeLocationCheckin(storage, dateString, locationId) {
    if (!Object.hasOwn(LOCATION_CHECKIN_OPTIONS, locationId)) {
        throw new TypeError('Unsupported checklist location option.');
    }
    const records = loadLocationCheckins(storage, dateString);
    delete records[locationId];
    const key = getLocationCheckinStorageKey(dateString);
    if (Object.keys(records).length) storage.setItem(key, JSON.stringify(records));
    else storage.removeItem(key);
    return records;
}

export function saveLocationCheckin(storage, dateString, locationId, position) {
    if (!Object.hasOwn(LOCATION_CHECKIN_OPTIONS, locationId)) {
        throw new TypeError('Unsupported checklist location option.');
    }

    const coordinates = position?.coords;
    const latitude = Number(coordinates?.latitude);
    const longitude = Number(coordinates?.longitude);
    const accuracyMeters = Number(coordinates?.accuracy);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
        || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
        throw new TypeError('The browser did not return valid location coordinates.');
    }

    const timestamp = Number(position?.timestamp);
    const capturedAt = new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()).toISOString();
    const records = loadLocationCheckins(storage, dateString);
    records[locationId] = { latitude, longitude, accuracyMeters, capturedAt };

    storage.setItem(getLocationCheckinStorageKey(dateString), JSON.stringify(records));
    return records[locationId];
}
