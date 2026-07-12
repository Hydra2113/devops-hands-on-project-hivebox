// Pure temperature math, split out so it can be unit-tested without the network
// or a running server. `now` is injectable so the 1-hour cutoff is deterministic in tests.
export function recentTemperatures(boxes, now = Date.now()) {
    const oneHourAgo = now - 60 * 60 * 1000;

    return boxes.flatMap(box =>
        (box.sensors ?? [])
            .filter(s => /temperatur/i.test(s.title ?? ''))
            .map(s => s.lastMeasurement)
            .filter(m => m && new Date(m.createdAt).getTime() >= oneHourAgo)
            .map(m => Number(m.value))
    );
}

export function averageRecentTemperature(boxes, now = Date.now()) {
    const temps = recentTemperatures(boxes, now);
    if (temps.length === 0) return null;
    return temps.reduce((a, b) => a + b, 0) / temps.length;
}

// Spec: <10 Too Cold, 11-36 Good, >37 Too Hot. The spec leaves 10-11 and
// 36-37 undefined; averages are floats, so the bands are closed here
// (<10 cold, <=36 good, else hot) to leave no gaps.
export function temperatureStatus(avg) {
    if (avg < 10) return 'Too Cold';
    if (avg <= 36) return 'Good';
    return 'Too Hot';
}
