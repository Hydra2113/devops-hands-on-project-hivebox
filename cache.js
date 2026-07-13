import { createClient } from 'redis';

// Fail-open cache: every helper swallows connection errors and returns a
// miss instead. A dead Valkey must degrade to "slower", never to an outage.
const client = createClient({
    url: process.env.VALKEY_URL ?? 'redis://localhost:6379',
    // The cache is optional: fail fast instead of patiently retrying a dead
    // server (default settings cost ~10s per request while Valkey is down).
    disableOfflineQueue: true,
    socket: {
        connectTimeout: 2000,
        reconnectStrategy: retries => (retries >= 2 ? false : 200),
    },
});
client.on('error', () => {}); // errors surface as failed commands below; don't crash the process

async function connected() {
    if (!client.isOpen) await client.connect();
    return client;
}

export async function cacheGet(key) {
    try {
        return await (await connected()).get(key);
    } catch {
        return null;
    }
}

export async function cacheDel(key) {
    try {
        await (await connected()).del(key);
    } catch {
        // best-effort, same as set
    }
}

export async function cacheSet(key, ttlSeconds, value) {
    try {
        await (await connected()).set(key, value, { EX: ttlSeconds });
    } catch {
        // best-effort: a value we failed to cache is recomputed next request
    }
}

// Tests import the app, which imports this module; an open client would hold
// the event loop and hang the test runner, so tests close it explicitly.
export async function cacheClose() {
    if (client.isOpen) await client.destroy();
}
