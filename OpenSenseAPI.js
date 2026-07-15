import express from 'express';
import { fileURLToPath } from 'node:url';
import client from 'prom-client';
import { averageRecentTemperature, recentTemperatures, temperatureStatus } from './temperature.js';
import { cacheGet, cacheSet } from './cache.js';
import { putSnapshot } from './storage.js';

const app = express();
client.collectDefaultMetrics(); // CPU, memory, event-loop lag, etc.
const PORT = 3000;
const version = 'v0.0.1';

const BOX_IDS = ["5eba5fbad46fb8001b799786", "5c21ff8f919bf8001adf2488", "5ade1acf223bd80019a1011c"];

// Custom metrics, one per thing the code can actually do wrong or slow.
const temperatureRequests = new client.Counter({
    name: 'hivebox_temperature_requests_total',
    help: 'Requests to /temperature by outcome (ok, no_fresh_data, upstream_error)',
    labelNames: ['outcome'],
});
const upstreamDuration = new client.Histogram({
    name: 'hivebox_opensensemap_request_duration_seconds',
    help: 'Latency of individual openSenseMap box fetches',
});
const freshReadings = new client.Gauge({
    name: 'hivebox_fresh_readings',
    help: 'Temperature readings fresher than 1 hour in the last upstream fetch',
});
const temperatureCelsius = new client.Gauge({
    name: 'hivebox_temperature_celsius',
    help: 'Last computed average temperature',
});
const httpDuration = new client.Histogram({
    name: 'hivebox_http_request_duration_seconds',
    help: 'HTTP request duration by route and status code',
    labelNames: ['route', 'status'],
});
const cacheRequests = new client.Counter({
    name: 'hivebox_cache_requests_total',
    help: 'Cache lookups for /temperature by result (fail-open errors count as misses)',
    labelNames: ['result'],
});

// Time every request; labels resolved when the response finishes.
app.use((req, res, next) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => end({ route: req.path, status: res.statusCode }));
    next();
});

// Fetch every box, then average their recent temperature readings.
async function getAverageTemperature() {
    const boxes = await Promise.all(
        BOX_IDS.map(async id => {
            const end = upstreamDuration.startTimer();
            try {
                const r = await fetch(`https://api.opensensemap.org/boxes/${id}`);
                return await r.json();
            } finally {
                end();
            }
        })
    );
    freshReadings.set(recentTemperatures(boxes).length);
    return averageRecentTemperature(boxes);
}


app.get('/version', (req, res) => {
    res.json({ version });
});


const CACHE_KEY = 'temperature';
const CACHE_TTL_SECONDS = 300; // senseBoxes report every few minutes; well within the 1h freshness rule

app.get('/temperature', async (req, res) => {
    try {
        const cached = await cacheGet(CACHE_KEY);
        if (cached) {
            cacheRequests.inc({ result: 'hit' });
            temperatureRequests.inc({ outcome: 'ok' });
            return res.json(JSON.parse(cached));
        }
        cacheRequests.inc({ result: 'miss' });

        const average = await getAverageTemperature();
        if (average === null) {
            temperatureRequests.inc({ outcome: 'no_fresh_data' });
            return res.status(404).json({ error: 'no recent temperature data' });
        }
        temperatureRequests.inc({ outcome: 'ok' });
        temperatureCelsius.set(average);
        const body = { temperature: average, unit: 'C', status: temperatureStatus(average) };
        await cacheSet(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(body));
        res.json(body);
    } catch {
        temperatureRequests.inc({ outcome: 'upstream_error' });
        res.status(502).json({ error: 'upstream unreachable' });
    }
});

// Compute the current temperature and write it to MinIO as one snapshot.
// Shared by the 5-minute timer and the /store endpoint.
async function storeSnapshot() {
    const average = await getAverageTemperature();
    if (average === null) return null;
    return putSnapshot({
        temperature: average,
        unit: 'C',
        status: temperatureStatus(average),
        storedAt: new Date().toISOString(),
    });
}

app.get('/store', async (req, res) => {
    try {
        const key = await storeSnapshot();
        if (key === null) return res.status(404).json({ error: 'no recent temperature data' });
        res.json({ stored: key });
    } catch {
        res.status(502).json({ error: 'store failed' });
    }
});

// Readiness: this pod can serve /temperature if a majority of boxes answer,
// or a fresh cached response exists (cache entries expire at exactly 5
// minutes, so "cached" implies "newer than 5 minutes").
const READY_MAJORITY = Math.floor(BOX_IDS.length / 2) + 1; // "50% + 1"

// Memoised so kubelet probes (every ~10s per pod) don't hammer openSenseMap.
// The interval is env-tunable mainly so tests can set it to 0.
let lastBoxCheck = { at: 0, down: 0 };
async function countBoxesDown() {
    const memoMs = Number(process.env.READY_CHECK_TTL_MS ?? 30_000);
    if (Date.now() - lastBoxCheck.at < memoMs) return lastBoxCheck.down;

    const reachable = await Promise.all(
        BOX_IDS.map(async id => {
            try {
                const r = await fetch(`https://api.opensensemap.org/boxes/${id}`, {
                    signal: AbortSignal.timeout(2000), // probes must answer fast
                });
                return r.ok;
            } catch {
                return false;
            }
        })
    );
    lastBoxCheck = { at: Date.now(), down: reachable.filter(ok => !ok).length };
    return lastBoxCheck.down;
}

app.get('/readyz', async (req, res) => {
    const boxesDown = await countBoxesDown();
    const cacheFresh = (await cacheGet(CACHE_KEY)) !== null;
    const ready = boxesDown < READY_MAJORITY || cacheFresh;
    res.status(ready ? 200 : 503).json({ ready, boxesDown, cacheFresh });
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.send(await client.register.metrics());
});

// Only start the server when run directly (`node OpenSenseAPI.js`), not when
// imported by a test — the test boots its own instance on a random port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    // ponytail: every replica runs its own timer, so 2+ pods write duplicate
    // snapshots; move to a k8s CronJob (or leader election) when that matters.
    setInterval(() => storeSnapshot().catch(e => console.error('periodic store failed:', e.message)), 5 * 60 * 1000);
    app.listen(PORT, () => {
        console.log(`server is successfully running on http://localhost:${PORT}`);
    });
}

export default app;

