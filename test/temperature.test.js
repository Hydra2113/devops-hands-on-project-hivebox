import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRecentTemperature, temperatureStatus } from '../temperature.js';

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

test('temperatureStatus maps averages to bands, boundaries included', () => {
    assert.equal(temperatureStatus(-5), 'Too Cold');
    assert.equal(temperatureStatus(9.9), 'Too Cold');
    assert.equal(temperatureStatus(10), 'Good');     // band edge: cold ends below 10
    assert.equal(temperatureStatus(25), 'Good');
    assert.equal(temperatureStatus(36), 'Good');     // band edge: good ends at 36
    assert.equal(temperatureStatus(36.1), 'Too Hot');
    assert.equal(temperatureStatus(40), 'Too Hot');
});
