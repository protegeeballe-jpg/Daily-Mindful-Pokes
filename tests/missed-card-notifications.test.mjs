import test from 'node:test';
import assert from 'node:assert/strict';
import { getMissedChecklistCards } from '../assets/missed-card-notifications.js';

const sections = [
    { number: 1, title: 'Where are you right now?', ids: ['loc-home', 'loc-office', 'loc-house', 'loc-out'] },
    { number: 2, title: 'Before You Start', ids: ['start-1', 'start-2'] },
    { number: 3, title: 'Mid-Day & Lunchbreak', ids: ['mid-1', 'mid-2'] }
];

test('Card 1 is complete after one location is selected, while other cards need every check', () => {
    const data = {
        'loc-home': true,
        'loc-office': false,
        'loc-house': false,
        'loc-out': false,
        'start-1': true,
        'start-2': false,
        'mid-1': true,
        'mid-2': true
    };

    assert.deepEqual(getMissedChecklistCards(data, sections), [
        { number: 2, title: 'Before You Start' }
    ]);
});

test('does not create reminders for a day with no recorded activity', () => {
    const data = {
        'loc-home': false,
        'loc-home__guided': false,
        'start-1': false,
        'start-2': false,
        cloud_flow_version: 1
    };
    assert.deepEqual(getMissedChecklistCards(data, sections), []);
    assert.deepEqual(getMissedChecklistCards({}, sections), []);
    assert.deepEqual(getMissedChecklistCards(null, sections), []);
});

test('returns one reminder for each incomplete card in checklist order', () => {
    const data = {
        'start-1': true,
        'start-2': true,
        'mid-1': true,
        'mid-2': true
    };
    assert.deepEqual(getMissedChecklistCards(data, sections), [
        { number: 1, title: 'Where are you right now?' }
    ]);
});

test('returns no reminders when every supplied card is complete', () => {
    const data = {
        'loc-home': true,
        'loc-office': false,
        'loc-house': false,
        'loc-out': false,
        'start-1': true,
        'start-2': true,
        'mid-1': true,
        'mid-2': true
    };
    assert.deepEqual(getMissedChecklistCards(data, sections), []);
});
