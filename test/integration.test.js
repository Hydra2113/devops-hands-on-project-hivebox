import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../OpenSenseAPI.js';

// Integration boundary: the real app, real HTTP, real routing — only the
// upstream openSenseMap API is faked. Each test scripts `upstream` to play
// healthy, stale, or dead, then asserts the response our server gives.
let server, base;
const realFetch = globalThis.fetch;
const upstream = { handler: null };

before(() => new Promise(resolve => {
    globalThis.fetch = (url, opts) =>
        String(url).includes('api.opensensemap.org')
            ? upstream.handler(url)
            : realFetch(url, opts); // the test's own requests to localhost pass through
    server = app.listen(0, () => {
        base = `http://localhost:${server.address().port}`;
        resolve();
    });
}));

after(() => new Promise(resolve => {
    globalThis.fetch = realFetch;
    server.close(resolve);
}));

const boxWithReading = (value, createdAt) => ({
    sensors: [{ title: 'Temperatur', lastMeasurement: { value: String(value), createdAt } }],
});
const respondWith = box => async () => ({ json: async () => box });

test('GET /temperature averages upstream readings and reports status', async () => {
    upstream.handler = respondWith(boxWithReading(20, new Date().toISOString()));
    const res = await fetch(`${base}/temperature`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { temperature: 20, unit: 'C', status: 'Good' });
});

test('GET /temperature returns 404 when upstream data is stale', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    upstream.handler = respondWith(boxWithReading(20, twoHoursAgo));
    const res = await fetch(`${base}/temperature`);
    assert.equal(res.status, 404);
});

test('GET /temperature returns 502 when upstream is unreachable', async () => {
    upstream.handler = async () => { throw new Error('ECONNREFUSED'); };
    const res = await fetch(`${base}/temperature`);
    assert.equal(res.status, 502);
});

test('GET /temperature returns 502 when upstream sends malformed JSON', async () => {
    upstream.handler = async () => ({ json: async () => { throw new Error('bad json'); } });
    const res = await fetch(`${base}/temperature`);
    assert.equal(res.status, 502);
});

test('GET /metrics serves Prometheus metrics', async () => {
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    assert.match(await res.text(), /process_cpu_user_seconds_total/);
});
