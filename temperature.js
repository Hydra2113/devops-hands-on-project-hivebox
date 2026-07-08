// Pure temperature math, split out so it can be unit-tested without the network
// or a running server. `now` is injectable so the 1-hour cutoff is deterministic in tests.
export function averageRecentTemperature(boxes, now = Date.now()) {
    const oneHourAgo = now - 60 * 60 * 1000;

    const temps = boxes.flatMap(box =>
        (box.sensors ?? [])
            .filter(s => /temperatur/i.test(s.title ?? ''))
            .map(s => s.lastMeasurement)
            .filter(m => m && new Date(m.createdAt).getTime() >= oneHourAgo)
            .map(m => Number(m.value))
    );

    if (temps.length === 0) return null;
    return temps.reduce((a, b) => a + b, 0) / temps.length;
}
