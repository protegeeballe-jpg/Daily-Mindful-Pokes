export const GARDEN_STORAGE_KEY = 'daily_mindful_pokes_garden_v1';

export const TREE_TYPES = Object.freeze({
    mango: Object.freeze({ name: 'Mango', fruit: '🥭' }),
    rambutan: Object.freeze({ name: 'Rambutan', fruit: '🍒' }),
    apple: Object.freeze({ name: 'Apple', fruit: '🍎' })
});

export const FLOWER_TYPES = Object.freeze({
    sunflower: Object.freeze({ name: 'Sunflower', bloom: '🌻' }),
    cosmos: Object.freeze({ name: 'Cosmos', bloom: '🌸' }),
    zinnia: Object.freeze({ name: 'Zinnia', bloom: '🌺' })
});

const DAY_MS = 24 * 60 * 60 * 1000;

const TREE_STAGES = Object.freeze([
    Object.freeze({ id: 'seed', label: 'A little seed', emoji: '🟤', startAt: 0, nextAt: 7 }),
    Object.freeze({ id: 'sprout', label: 'First tiny sprout', emoji: '🌱', startAt: 7, nextAt: 30 }),
    Object.freeze({ id: 'seedling', label: 'A leafy seedling', emoji: '🌿', startAt: 30, nextAt: 90 }),
    Object.freeze({ id: 'young-tree', label: 'A young tree', emoji: '🪴', startAt: 90, nextAt: 180 }),
    Object.freeze({ id: 'sapling', label: 'A growing sapling', emoji: '🌳', startAt: 180, nextAt: 365 }),
    Object.freeze({ id: 'one-year-tree', label: 'One year of growing!', emoji: '🌳', startAt: 365, nextAt: null })
]);

const FLOWER_STAGES = Object.freeze([
    Object.freeze({ id: 'seed', label: 'A little seed', emoji: '🟤', startAt: 0, nextAt: 4 }),
    Object.freeze({ id: 'sprout', label: 'A fresh sprout', emoji: '🌱', startAt: 4, nextAt: 14 }),
    Object.freeze({ id: 'seedling', label: 'A leafy seedling', emoji: '🌿', startAt: 14, nextAt: 30 }),
    Object.freeze({ id: 'bud', label: 'A tiny flower bud', emoji: '🌷', startAt: 30, nextAt: 60 }),
    Object.freeze({ id: 'first-bloom', label: 'The first bloom', emoji: '🌼', startAt: 60, nextAt: 90 }),
    Object.freeze({ id: 'full-bloom', label: 'A beautiful full bloom', emoji: '🌸', startAt: 90, nextAt: null })
]);

export function isISODate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return dateToEpochDay(value) !== null;
}

function dateToEpochDay(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);

    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return Math.floor(date.getTime() / DAY_MS);
}

export function daysBetweenDates(startDate, endDate) {
    const start = dateToEpochDay(startDate);
    const end = dateToEpochDay(endDate);
    if (start === null || end === null) return null;
    return Math.max(0, end - start);
}

export function getPlantAgeDays(plantedOn, today) {
    return daysBetweenDates(plantedOn, today);
}

function stageForAge(stages, ageDays) {
    const age = Number.isFinite(ageDays) ? Math.max(0, Math.floor(ageDays)) : 0;
    let current = stages[0];
    for (const stage of stages) {
        if (age < stage.startAt) break;
        current = stage;
    }
    const progress = current.nextAt === null
        ? 100
        : Math.min(100, Math.max(0, ((age - current.startAt) / (current.nextAt - current.startAt)) * 100));

    return Object.freeze({
        id: current.id,
        label: current.label,
        emoji: current.emoji,
        ageDays: age,
        progress: Math.round(progress),
        nextAt: current.nextAt,
        daysUntilNext: current.nextAt === null ? 0 : Math.max(0, current.nextAt - age)
    });
}

export function getTreeStage(ageDays) {
    return stageForAge(TREE_STAGES, ageDays);
}

export function getFlowerStage(ageDays) {
    return stageForAge(FLOWER_STAGES, ageDays);
}

export function createGardenState(treeType, flowerType, plantedOn) {
    if (!Object.hasOwn(TREE_TYPES, treeType)) throw new TypeError('Choose a supported fruit tree.');
    if (!Object.hasOwn(FLOWER_TYPES, flowerType)) throw new TypeError('Choose a supported flower.');
    if (!isISODate(plantedOn)) throw new TypeError('A valid planting date is required.');

    return {
        version: 1,
        plantedOn,
        treeType,
        flowerType,
        wateringDates: [],
        notes: []
    };
}

export function validateGardenState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return null;
    if (!Object.hasOwn(TREE_TYPES, value.treeType) || !Object.hasOwn(FLOWER_TYPES, value.flowerType)) return null;
    if (!isISODate(value.plantedOn)) return null;

    const wateringDates = Array.isArray(value.wateringDates)
        ? [...new Set(value.wateringDates.filter(isISODate))].slice(-3660)
        : [];

    const notes = Array.isArray(value.notes)
        ? value.notes.slice(-100).flatMap(note => {
            if (!note || typeof note !== 'object' || !isISODate(note.date) || typeof note.text !== 'string') return [];
            const text = note.text.trim().slice(0, 500);
            return text ? [{ date: note.date, text }] : [];
        })
        : [];

    return {
        version: 1,
        plantedOn: value.plantedOn,
        treeType: value.treeType,
        flowerType: value.flowerType,
        wateringDates,
        notes
    };
}
