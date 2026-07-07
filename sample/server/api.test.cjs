const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isRetryableExtractionError,
  normalizeApiError,
  withExtractionRetry,
} = require('./api.cjs');

test('withExtractionRetry retries transient YouTube egress failures', async () => {
  let calls = 0;

  const value = await withExtractionRetry(
    async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('ios: LOGIN_REQUIRED - Sign in to confirm you are not a bot');
      }
      return { subtitles: [{ text: 'ok' }] };
    },
    { attempts: 3, baseDelayMs: 0 }
  );

  assert.equal(calls, 2);
  assert.deepEqual(value, { subtitles: [{ text: 'ok' }] });
});

test('withExtractionRetry does not retry permanent video errors', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      withExtractionRetry(
        async () => {
          calls += 1;
          throw new Error('Video unavailable');
        },
        { attempts: 3, baseDelayMs: 0 }
      ),
    /Video unavailable/
  );

  assert.equal(calls, 1);
});

test('normalizeApiError maps bot challenges to the public egress error', () => {
  const normalized = normalizeApiError(
    new Error('mweb: LOGIN_REQUIRED - Sign in to confirm you are not a bot')
  );

  assert.equal(normalized.status, 503);
  assert.equal(normalized.body.code, 'youtube_blocked_datacenter_ip');
});

test('isRetryableExtractionError recognises transient statuses', () => {
  assert.equal(
    isRetryableExtractionError(new Error('Caption fetch failed: 503')),
    true
  );
  assert.equal(
    isRetryableExtractionError(new Error('This video is unavailable')),
    false
  );
});
