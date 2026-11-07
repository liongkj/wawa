import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const request = (email, locale = 'en') => new Request('https://example.test/api/waitlist', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, locale }),
});

function bucket() {
  const data = new Map();
  return { data, async put(key, value, options) {
    assert.equal(options.onlyIf.get('If-None-Match'), '*');
    if (data.has(key)) return null;
    data.set(key, JSON.parse(value));
    return { key };
  } };
}

test('keeps a signup when confirmation is unavailable', async () => {
  const WAITLIST = bucket();
  const response = await worker.fetch(request('person@example.test', 'ms'), { WAITLIST });
  const [saved] = WAITLIST.data.values();
  assert.equal(saved.email, 'person@example.test');
  assert.equal(saved.locale, 'ms');
  assert.deepEqual(await response.json(), { status: 'saved', confirmation: 'not_sent' });
});

test('treats email addresses case insensitively and sends no duplicate confirmation', async () => {
  const WAITLIST = bucket();
  let sends = 0;
  const env = { WAITLIST, EMAIL: { send: async () => { sends++; } } };
  await worker.fetch(request('Person@example.test'), env);
  const response = await worker.fetch(request('person@example.test'), env);
  assert.deepEqual(await response.json(), { status: 'already' });
  assert.equal(WAITLIST.data.size, 1);
  assert.equal(sends, 1);
});
