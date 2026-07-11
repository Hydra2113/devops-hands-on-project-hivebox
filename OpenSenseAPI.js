import express from 'express';
import { fileURLToPath } from 'node:url';
import client from 'prom-client';
import { averageRecentTemperature, temperatureStatus } from './temperature.js';

const app = express();
client.collectDefaultMetrics(); // CPU, memory, event-loop lag, etc.
const PORT = 3000;
const version = 'v0.0.1';

const BOX_IDS = ["5eba5fbad46fb8001b799786", "5c21ff8f919bf8001adf2488", "5ade1acf223bd80019a1011c"];

// Fetch every box, then average their recent temperature readings.
async function getAverageTemperature() {
    const boxes = await Promise.all(
        BOX_IDS.map(id =>
            fetch(`https://api.opensensemap.org/boxes/${id}`).then(r => r.json())
        )
    );
    return averageRecentTemperature(boxes);
}


app.get('/version', (req, res) => {
    res.json({ version });
});


app.get('/temperature', async (req, res) => {
    try {
        const average = await getAverageTemperature();
        if (average === null) return res.status(404).json({ error: 'no recent temperature data' });
        res.json({ temperature: average, unit: 'C', status: temperatureStatus(average) });
    } catch {
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

