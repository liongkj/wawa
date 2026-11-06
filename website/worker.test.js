import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

test('region endpoint identifies Malaysian visitors without returning their IP', async () => {
  for (const [country, malaysia] of [['MY', true], ['US', false], [undefined, false]]) {
    const request = new Request('https://example.com/api/region');
    if (country) Object.defineProperty(request, 'cf', { value: { country } });
    const response = await worker.fetch(request, { ASSETS: { fetch: () => { throw new Error('region should not fetch assets'); } } });
    assert.deepEqual(await response.json(), { malaysia });
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});
