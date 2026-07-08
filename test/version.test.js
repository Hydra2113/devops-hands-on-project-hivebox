import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../OpenSenseAPI.js';

let server, base;

// Boot the real app on a random free port (0 = OS picks one), tear it down after.
before(() => new Promise(resolve => {
    server = app.listen(0, () => {
        base = `http://localhost:${server.address().port}`;
        resolve();
    });
}));
after(() => new Promise(resolve => server.close(resolve)));

test('GET /version returns v0.0.1', async () => {
    const res = await fetch(`${base}/version`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { version: 'v0.0.1' });
});
