const assert = require('node:assert/strict');
const test = require('node:test');

process.env.EXTRACTION_RETRY_BASE_DELAY_MS = '0';
process.env.EXTRACTION_ATTEMPTS = '3';
process.env.CACHE_TTL_SECONDS = '21600';
delete process.env.OUTBOUND_PROXY_URL;

const {
  app,
  isRetryableExtractionError,
  normalizeApiError,
  withExtractionRetry,
} = require('./api.cjs');

const subtitle = { start: '0', dur: '1', text: 'Hello' };

function mockYouTube(t, captionResponse, hasTracks = true) {
  let captionCalls = 0;
  let playerCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/player?')) {
      playerCalls += 1;
      return Response.json({
        playabilityStatus: { status: 'OK' },
        videoDetails: { title: 'Test video', shortDescription: 'Description' },
        captions: hasTracks ? { playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl: 'https://example.test/timedtext?v=test', languageCode: 'en' }],
        } } : undefined,
      });
    }
    captionCalls += 1;
    return captionResponse(captionCalls);
  });
  return { get captionCalls() { return captionCalls; }, get playerCalls() { return playerCalls; } };
}

function validCaptions() {
  return Response.json({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello' }] }] });
}

test('video details retries a swallowed caption failure and caches only recovery', async (t) => {
  const upstream = mockYouTube(t, (call) => call <= 2
    ? new Response('', { status: 503 }) : validCaptions());
  const url = '/api/videoDetails?videoID=retry-recovery';
  const response = await app.request(url);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).videoDetails.subtitles, [subtitle]);
  assert.match(response.headers.get('cache-control'), /public/);
  const calls = upstream.captionCalls;
  assert.ok(calls >= 3);
  const cached = await app.request(url);
  assert.equal(cached.headers.get('x-cache'), 'HIT');
  assert.deepEqual((await cached.json()).videoDetails.subtitles, [subtitle]);
  assert.equal(upstream.captionCalls, calls);
});

test('persistent caption fetch failures remain errors and are not cached', async (t) => {
  const upstream = mockYouTube(t, () => new Response('', { status: 503 }));
  const url = '/api/videoDetails?videoID=persistent-failure';
  const response = await app.request(url);
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /Caption fetch failed: 503/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const calls = upstream.captionCalls;
  assert.ok(calls >= 3);
  await app.request(url);
  assert.ok(upstream.captionCalls > calls);
});

for (const path of ['videoDetails', 'subtitles']) {
  test(`${path} does not cache videos with no caption tracks`, async (t) => {
    const upstream = mockYouTube(t, validCaptions, false);
    const url = `/api/${path}?videoID=no-tracks-${path}`;
    const response = await app.request(url);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(path === 'videoDetails' ? body.videoDetails.subtitles : body.subtitles, []);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const calls = upstream.playerCalls;
    await app.request(url);
    assert.ok(upstream.playerCalls > calls);
  });
}

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

const membersOnlyReason = "This video is available to this channel's members on level: SCG SUPERFAN (or any higher level). Join this channel to get access to members-only content and other exclusive perks.";

for (const path of ['videoDetails', 'subtitles']) {
  test(`${path} returns an uncached access restriction after one extraction attempt`, async (t) => {
    let playerCalls = 0;
    t.mock.method(globalThis, 'fetch', async (url) => {
      assert.match(String(url), /\/player\?/);
      playerCalls += 1;
      return Response.json({
        playabilityStatus: { status: 'UNPLAYABLE', reason: membersOnlyReason },
      });
    });
    const url = `/api/${path}?videoID=members-only-${path}`;
    const response = await app.request(url);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      code: 'video_access_restricted',
      reason: 'members_only',
      message: 'This video is members-only and requires the appropriate channel membership. This API cannot access its captions.',
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-cache'), null);
    // The library checks its three clients once. The API must not repeat them.
    assert.equal(playerCalls, 3);
    const second = await app.request(url);
    assert.equal(second.status, 403);
    assert.equal(playerCalls, 6);
  });
}

test('a membership error on one client still allows another playable client', async (t) => {
  let playerCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (!String(url).includes('/player?')) return validCaptions();
    playerCalls += 1;
    if (playerCalls === 1) {
      return Response.json({ playabilityStatus: { status: 'UNPLAYABLE', reason: membersOnlyReason } });
    }
    return Response.json({
      playabilityStatus: { status: 'OK' },
      captions: { playerCaptionsTracklistRenderer: {
        captionTracks: [{ baseUrl: 'https://example.test/timedtext?v=test', languageCode: 'en' }],
      } },
    });
  });
  const response = await app.request('/api/subtitles?videoID=playable-fallback');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).subtitles, [subtitle]);
  assert.equal(playerCalls, 2);
});

for (const reason of [
  membersOnlyReason,
  'This is a MEMBERS-ONLY video',
  'This video is for members only',
  'This video is available to this channel’s members on level: SUPERFAN',
]) {
  test(`membership restriction is permanent: ${reason}`, () => {
    const error = new Error(`Video not playable on any client. Attempts:\nios: UNPLAYABLE - ${reason}\nmweb: LOGIN_REQUIRED - Sign in to confirm you are not a bot`);
    assert.equal(normalizeApiError(error).status, 403);
    assert.equal(normalizeApiError(error).body.code, 'video_access_restricted');
    assert.equal(isRetryableExtractionError(error), false);
  });
}
