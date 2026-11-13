import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FLOWER_TYPES, GARDEN_STORAGE_KEY, TREE_TYPES, createGardenState, daysBetweenDates,
    getFlowerStage, getPlantAgeDays, getTreeStage, isISODate, mergeGardenStates, validateGardenState
} from '../assets/garden-model.js';

test('the first garden contains one supported fruit tree seed and one flower seed', () => {
    const garden = createGardenState('mango', 'sunflower', '2026-11-08');
    assert.equal(garden.version, 1);
    assert.equal(garden.treeType, 'mango');
    assert.equal(garden.flowerType, 'sunflower');
    assert.equal(garden.wateringDates.length, 0);
    assert.equal(Object.hasOwn(garden, 'notes'), false);
    assert.equal(Object.keys(TREE_TYPES).length, 3);
    assert.equal(Object.keys(FLOWER_TYPES).length, 3);
});

test('an absent or cleared garden record allows initial planting setup again',()=>{
    assert.equal(validateGardenState(null), null);
    assert.equal(validateGardenState(undefined), null);
    const planted = createGardenState('rambutan', 'cosmos', '2026-11-09');
    assert.notEqual(validateGardenState(planted), null);
    assert.equal(validateGardenState(planted).treeType, 'rambutan');
    assert.equal(validateGardenState(planted).flowerType, 'cosmos');
});
test('Faith & Focus growth descriptions and legacy garden storage remain aligned',()=>{
    assert.equal(GARDEN_STORAGE_KEY, 'daily_mindful_pokes_garden_v1');
    assert.equal(getTreeStage(0).label, 'A seed of Hope and Faith');
    assert.equal(getFlowerStage(0).label, 'A seed of Hope and Faith');
    assert.equal(getTreeStage(7).label, 'Hope and Faith taking root');
    assert.equal(getFlowerStage(60).label, 'The first bloom of hope');
});
test('tree growth follows calendar milestones through its first year', () => {
    assert.equal(getTreeStage(0).id, 'seed');
    assert.equal(getTreeStage(6).id, 'seed');
    assert.equal(getTreeStage(7).id, 'sprout');
    assert.equal(getTreeStage(30).id, 'seedling');
    assert.equal(getTreeStage(90).id, 'young-tree');
    assert.equal(getTreeStage(180).id, 'sapling');
    assert.equal(getTreeStage(365).id, 'one-year-tree');
    assert.equal(getTreeStage(900).id, 'one-year-tree');
    assert.equal(getTreeStage(365).progress, 100);
});

test('flower growth reaches bloom on its own slower calendar', () => {
    assert.equal(getFlowerStage(0).id, 'seed');
    assert.equal(getFlowerStage(4).id, 'sprout');
    assert.equal(getFlowerStage(14).id, 'seedling');
    assert.equal(getFlowerStage(30).id, 'bud');
    assert.equal(getFlowerStage(60).id, 'first-bloom');
    assert.equal(getFlowerStage(90).id, 'full-bloom');
});

test('calendar age is timezone-independent and handles leap days', () => {
    assert.equal(daysBetweenDates('2024-02-28', '2024-03-01'), 2);
    assert.equal(daysBetweenDates('2026-11-08', '2026-11-08'), 0);
    assert.equal(getPlantAgeDays('2026-11-08', '2026-11-18'), 10);
    assert.equal(daysBetweenDates('2026-11-18', '2026-11-08'), 0);
});

test('invalid dates and impossible calendar days are rejected', () => {
    for (const value of ['2026-02-29', '2026-13-01', '2026-00-10', 'not-a-date', '2026-1-01']) {
        assert.equal(isISODate(value), false);
    }
    assert.equal(daysBetweenDates('bad', '2026-11-08'), null);
});

test('garden creation rejects unsupported or invalid values', () => {
    assert.throws(() => createGardenState('banana', 'sunflower', '2026-11-08'), TypeError);
    assert.throws(() => createGardenState('mango', 'rose', '2026-11-08'), TypeError);
    assert.throws(() => createGardenState('mango', 'sunflower', '2026-02-29'), TypeError);
});

test('saved garden data is normalized and unsafe fields are discarded', () => {
    const restored = validateGardenState({
        version: 1,
        plantedOn: '2026-11-08',
        treeType: 'mango',
        flowerType: 'cosmos',
        wateringDates: ['2026-11-08', 'bad', '2026-11-08'],
        notes: [{ date: '2026-11-08', text: '  First leaf!  ' }, { date: '2026-11-09', text: '<script>' }],
        unexpected: 'ignored'
    });
    assert.deepEqual(restored.wateringDates, ['2026-11-08']);
    assert.equal(Object.hasOwn(restored, 'notes'), false);
    assert.equal(Object.hasOwn(restored, 'unexpected'), false);
    assert.equal(validateGardenState({ ...restored, treeType: 'data:text/html' }), null);
    assert.equal(validateGardenState({ ...restored, version: 2 }), null);
});

test('Garden snapshots keep their update time and older snapshots cannot replace newer plants', () => {
    const local = {
        ...createGardenState('mango', 'sunflower', '2026-11-08'),
        updatedAt: '2026-11-13T10:00:00.000Z',
        wateringDates: ['2026-11-09']
    };
    const olderRemote = {
        ...createGardenState('rambutan', 'cosmos', '2026-11-09'),
        updatedAt: '2026-11-10T10:00:00.000Z'
    };
    const merged = mergeGardenStates(local, olderRemote);
    assert.equal(merged.treeType, 'mango');
    assert.equal(merged.flowerType, 'sunflower');
    assert.equal(merged.updatedAt, local.updatedAt);
    assert.deepEqual(merged.wateringDates, ['2026-11-09']);
});

test('Garden snapshots merge watering history for the same planting and accept a newer remote update', () => {
    const local = {
        version: 1, plantedOn: '2026-11-08', treeType: 'mango', flowerType: 'sunflower',
        wateringDates: ['2026-11-09'], updatedAt: '2026-11-10T10:00:00.000Z'
    };
    const remote = {
        version: 1, plantedOn: '2026-11-08', treeType: 'mango', flowerType: 'sunflower',
        wateringDates: ['2026-11-11'], updatedAt: '2026-11-12T10:00:00.000Z'
    };
    const merged = mergeGardenStates(local, remote);
    assert.deepEqual(merged.wateringDates, ['2026-11-09', '2026-11-11']);
    assert.equal(merged.updatedAt, remote.updatedAt);
});

test('legacy Garden records without update timestamps remain readable', () => {
    const legacy = validateGardenState({
        version: 1, plantedOn: '2026-11-08', treeType: 'mango', flowerType: 'sunflower',
        wateringDates: []
    });
    assert.equal(legacy.updatedAt, '2026-11-08T00:00:00.000Z');
});
