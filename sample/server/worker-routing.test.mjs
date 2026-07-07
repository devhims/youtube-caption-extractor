import assert from 'node:assert/strict';
import test from 'node:test';

import {
  containerSlotOrderForUrl,
  routingKeyFromUrl,
} from './worker-routing.mjs';

test('routingKeyFromUrl ignores unrelated cache-busting query params', () => {
  assert.equal(
    routingKeyFromUrl(
      'https://example.com/api/videoDetails?videoID=55pTFVoclvE&lang=en&t=1'
    ),
    routingKeyFromUrl(
      'https://example.com/api/videoDetails?lang=en&videoID=55pTFVoclvE&t=2'
    )
  );
});

test('containerSlotOrderForUrl returns a stable primary and all fallback slots', () => {
  const url =
    'https://example.com/api/videoDetails?videoID=55pTFVoclvE&lang=en';
  const first = containerSlotOrderForUrl(url, 4);
  const second = containerSlotOrderForUrl(url, 4);

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.deepEqual([...new Set(first)].sort(), [0, 1, 2, 3]);
});

test('containerSlotOrderForUrl handles invalid instance counts', () => {
  assert.deepEqual(containerSlotOrderForUrl('/api/videoDetails', 0), [0]);
  assert.deepEqual(containerSlotOrderForUrl('/api/videoDetails', 'nope'), [0]);
});
