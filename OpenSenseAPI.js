import express from 'express';
import { fileURLToPath } from 'node:url';
import client from 'prom-client';
import { averageRecentTemperature, recentTemperatures, temperatureStatus } from './temperature.js';

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


app.get('/temperature', async (req, res) => {
    try {
        const average = await getAverageTemperature();
        if (average === null) {
            temperatureRequests.inc({ outcome: 'no_fresh_data' });
            return res.status(404).json({ error: 'no recent temperature data' });
        }
        temperatureRequests.inc({ outcome: 'ok' });
        temperatureCelsius.set(average);
        res.json({ temperature: average, unit: 'C', status: temperatureStatus(average) });
    } catch {
        temperatureRequests.inc({ outcome: 'upstream_error' });
        res.status(502).json({ error: 'upstream unreachable' });
    }
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.send(await client.register.metrics());
});

// Only start the server when run directly (`node OpenSenseAPI.js`), not when
// imported by a test — the test boots its own instance on a random port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    app.listen(PORT, () => {
        console.log(`server is successfully running on http://localhost:${PORT}`);
    });
}

export default app;

