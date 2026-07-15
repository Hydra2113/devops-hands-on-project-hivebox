import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import app from '../OpenSenseAPI.js';
import { cacheDel, cacheClose } from '../cache.js';
import { storageClose } from '../storage.js';

// Independent S3 reader (not the app's client) to verify /store writes.
const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    },
    forcePathStyle: true,
});

// Integration boundary: the real app, real HTTP, real routing, and a real
// Valkey (from docker-compose) — only the upstream openSenseMap API is faked.
// Each test scripts `upstream` to play healthy, stale, or dead, then asserts
// the response our server gives.
let server, base;
const realFetch = globalThis.fetch;
const upstream = { handler: null };

// /readyz memoises its upstream check for 30s in production; disable the
// memo here so every test gets a fresh verdict. (Read lazily by the app.)
process.env.READY_CHECK_TTL_MS = '0';

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
    await cacheClose(); // open connections would hang the test runner
    storageClose();
    s3.destroy();
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

// After the metrics test so the exact-count assertions above stay valid.
test('GET /store writes a snapshot to MinIO', async () => {
    upstream.handler = respondWith(boxWithReading(20, new Date().toISOString()));
    const res = await fetch(`${base}/store`);
    assert.equal(res.status, 200);

    const { stored } = await res.json();
    assert.match(stored, /^temperature\/.+\.json$/);

    // Read the object back with our own client — proves it landed in MinIO,
    // not just that the endpoint claimed success.
    const obj = await s3.send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET ?? 'hivebox',
        Key: stored,
    }));
    const snapshot = JSON.parse(await obj.Body.transformToString());
    assert.equal(snapshot.temperature, 20);
    assert.equal(snapshot.status, 'Good');
    assert.ok(snapshot.storedAt);
});

test('GET /store returns 404 when upstream data is stale', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    upstream.handler = respondWith(boxWithReading(20, twoHoursAgo));
    const res = await fetch(`${base}/store`);
    assert.equal(res.status, 404);
});

// --- /readyz: ready unless a majority of boxes are down AND the cache is cold ---

// Handlers for the readiness check need an `ok` field (a real fetch Response
// property) — the /temperature handlers never read it.
const boxUp = async () => ({ ok: true, json: async () => boxWithReading(20, new Date().toISOString()) });
const boxDown = async () => { throw new Error('unreachable'); };
const ONE_BOX = '5eba5fbad46fb8001b799786'; // first configured senseBox id

test('GET /readyz is 200 when all boxes are reachable (cache cold)', async () => {
    upstream.handler = boxUp;
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ready: true, boxesDown: 0, cacheFresh: false });
});

test('GET /readyz is 200 when only a minority of boxes are down', async () => {
    upstream.handler = url => String(url).includes(ONE_BOX) ? boxDown() : boxUp();
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ready: true, boxesDown: 1, cacheFresh: false });
});

test('GET /readyz is 200 when a majority is down but the cache is fresh', async () => {
    upstream.handler = boxUp;
    await fetch(`${base}/temperature`); // populate the cache
    upstream.handler = boxDown;
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ready: true, boxesDown: 3, cacheFresh: true });
});

test('GET /readyz is 503 when a majority is down and the cache is cold', async () => {
    upstream.handler = url => String(url).includes(ONE_BOX) ? boxUp() : boxDown();
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ready: false, boxesDown: 2, cacheFresh: false });
});

test('GET /readyz is 503 when every box is down and the cache is cold', async () => {
    upstream.handler = boxDown;
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ready: false, boxesDown: 3, cacheFresh: false });
});
