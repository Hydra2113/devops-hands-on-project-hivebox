import express from 'express';
import { averageRecentTemperature } from './temperature.js';

const app = express();
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


app.use(express.json());

app.get('/version', (req, res) => {
    res.json({ version });
});


app.get('/temperature', async (req, res) => {
    try {
        const average = await getAverageTemperature();
        if (average === null) return res.status(404).json({ error: 'no recent temperature data' });
        res.json({ temperature: average, unit: 'C' });
    } catch {
        res.status(502).json({ error: 'upstream unreachable' });
    }
});

app.listen(PORT, () => {
    console.log(`server is successfully running on http://localhost:${PORT}`);
});

