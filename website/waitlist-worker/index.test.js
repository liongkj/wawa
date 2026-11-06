import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const request = (email, locale = 'en') =>
  new Request('https://example.test/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, locale }),
  });

test('keeps a signup when the confirmation email cannot be sent', async () => {
  const saved = [];
  const env = {
    WAITLIST: {
      prepare: () => ({
        bind: (email, locale) => ({
          run: async () => {
            saved.push({ email, locale });
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
    EMAIL: {
      send: async () => {
        throw new Error('unavailable');
      },
    },
  };
  const response = await worker.fetch(request('person@example.test', 'ms'), env);
  assert.deepEqual(saved, [{ email: 'person@example.test', locale: 'ms' }]);
  assert.deepEqual(await response.json(), { status: 'saved', confirmation: 'not_sent' });
});

test('does not send another confirmation for an existing signup', async () => {
  let sent = false;
  const env = {
    WAITLIST: {
      prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) }),
    },
    EMAIL: {
      send: async () => {
        sent = true;
      },
    },
  };
  const response = await worker.fetch(request('person@example.test'), env);
  assert.deepEqual(await response.json(), { status: 'already' });
  assert.equal(sent, false);
});
