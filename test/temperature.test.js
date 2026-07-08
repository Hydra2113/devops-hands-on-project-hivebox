import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRecentTemperature } from '../temperature.js';

const now = Date.now();
const fresh = new Date(now - 10 * 60 * 1000).toISOString();       // 10 min ago
const stale = new Date(now - 2 * 60 * 60 * 1000).toISOString();   // 2 hours ago

const box = (title, value, createdAt) => ({
    sensors: [{ title, lastMeasurement: { value, createdAt } }],
});

test('averages fresh temperature readings across boxes', () => {
    const boxes = [box('Temperatur', '20', fresh), box('Temperature', '22', fresh)];
    assert.equal(averageRecentTemperature(boxes, now), 21);
});

test('ignores readings older than 1 hour', () => {
    const boxes = [box('Temperatur', '20', fresh), box('Temperatur', '99', stale)];
    assert.equal(averageRecentTemperature(boxes, now), 20);
});

test('returns null when no fresh readings exist', () => {
    assert.equal(averageRecentTemperature([box('Temperatur', '99', stale)], now), null);
});

test('ignores non-temperature sensors', () => {
    assert.equal(averageRecentTemperature([box('Luftdruck', '1013', fresh)], now), null);
});

test('tolerates boxes with no sensors', () => {
    assert.equal(averageRecentTemperature([{}], now), null);
});
