import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const valid = { videoDetails: {
  title: 'Test video', subtitles: [{ start: '0', dur: '1', text: 'Hello' }],
} };
const empty = { videoDetails: { title: 'Test video', subtitles: [] } };

function runCanary(responses) {
  const script = new URL('./check-production-api.mjs', import.meta.url).href;
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    const responses = ${JSON.stringify(responses)};
    let calls = 0;
    globalThis.fetch = async () => {
      const response = responses[Math.min(calls++, responses.length - 1)];
      return Response.json(response.body, { status: response.status || 200 });
    };
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => originalTimeout(fn, ms === 30000 ? ms : 0);
    process.on('exit', () => console.log('REQUESTS=' + calls));
    await import(${JSON.stringify(script)});
  `], {
    encoding: 'utf8',
    env: { ...process.env, CAPTION_API_BASE_URL: 'https://example.test',
      CAPTION_API_VIDEO_IDS: 'test', CAPTION_API_ATTEMPTS: '3', CAPTION_API_TIMEOUT_MS: '30000' },
    timeout: 5000,
  });
}

test('retries HTTP 200 with empty captions and accepts a later valid response', () => {
  const result = runCanary([{ body: empty }, { body: valid }]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REQUESTS=2/);
  assert.match(result.stdout, /OK \(1 captions\)/);
});

test('fails after all attempts return empty captions', () => {
  const result = runCanary([{ body: empty }]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /REQUESTS=3/);
  assert.match(result.stderr, /subtitles must be a non-empty array/);
  assert.doesNotMatch(result.stdout, /OK/);
});

test('retries invalid payloads as well as HTTP errors', () => {
  const result = runCanary([{ status: 503, body: {} }, { body: {} }, { body: valid }]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REQUESTS=3/);
});
