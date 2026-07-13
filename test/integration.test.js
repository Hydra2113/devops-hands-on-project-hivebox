import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../OpenSenseAPI.js';
import { cacheDel, cacheClose } from '../cache.js';

// Integration boundary: the real app, real HTTP, real routing, and a real
// Valkey (from docker-compose) — only the upstream openSenseMap API is faked.
// Each test scripts `upstream` to play healthy, stale, or dead, then asserts
// the response our server gives.
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

// Each test starts with a cold cache, so scenarios can't leak into each
// other through a cached response.
beforeEach(() => cacheDel('temperature'));

after(async () => {
    globalThis.fetch = realFetch;
    await cacheClose(); // an open Valkey connection would hang the test runner
    await new Promise(resolve => server.close(resolve));
});

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

test('second request is served from the cache without calling openSenseMap', async () => {
    let upstreamCalls = 0;
    upstream.handler = async () => {
        upstreamCalls++;
        return { json: async () => boxWithReading(20, new Date().toISOString()) };
    };

    const first = await (await fetch(`${base}/temperature`)).json();
    const callsAfterFirst = upstreamCalls; // one per box
    assert.ok(callsAfterFirst > 0, 'first request should hit the upstream');

    const second = await (await fetch(`${base}/temperature`)).json();
    assert.equal(upstreamCalls, callsAfterFirst, 'second request must not hit the upstream');
    assert.deepEqual(second, first);
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

// Runs last: the /temperature tests above have already exercised every
// outcome, so the custom metrics must now be populated. Request tally:
// ok test (1 ok/miss) + cache test (2 ok: 1 miss + 1 hit) + stale (404/miss)
// + unreachable and malformed (502s, miss each).
test('custom metrics record the outcomes of earlier requests', async () => {
    const body = await (await fetch(`${base}/metrics`)).text();

    assert.match(body, /hivebox_temperature_requests_total\{outcome="ok"\} 3/);
    assert.match(body, /hivebox_temperature_requests_total\{outcome="no_fresh_data"\} 1/);
    assert.match(body, /hivebox_temperature_requests_total\{outcome="upstream_error"\} 2/);
    assert.match(body, /hivebox_cache_requests_total\{result="miss"\} 5/);
    assert.match(body, /hivebox_cache_requests_total\{result="hit"\} 1/);
    assert.match(body, /hivebox_fresh_readings 0/);          // last fetch was the stale-data test
    assert.match(body, /hivebox_temperature_celsius 20/);    // set by the ok test
    assert.match(body, /hivebox_opensensemap_request_duration_seconds_count/);
    assert.match(body, /hivebox_http_request_duration_seconds_count\{route="\/temperature"/);
});
