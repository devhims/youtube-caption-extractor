const baseUrl = (process.env.CAPTION_API_BASE_URL || '').replace(/\/+$/, '');
const videoIds = (process.env.CAPTION_API_VIDEO_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const lang = process.env.CAPTION_API_LANG || 'en';
const timeoutMs = Number(process.env.CAPTION_API_TIMEOUT_MS || 30_000);
const attempts = Math.max(
  1,
  Math.floor(Number(process.env.CAPTION_API_ATTEMPTS || 3))
);

if (!baseUrl) {
  throw new Error('CAPTION_API_BASE_URL is required');
}

if (videoIds.length === 0) {
  throw new Error('CAPTION_API_VIDEO_IDS must include at least one video ID');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSubtitle(subtitle, videoId) {
  assert(
    subtitle && typeof subtitle === 'object',
    `${videoId}: first subtitle must be an object`
  );
  assert(
    typeof subtitle.start === 'string' && !Number.isNaN(Number(subtitle.start)),
    `${videoId}: subtitle.start must be a numeric string`
  );
  assert(
    typeof subtitle.dur === 'string' && !Number.isNaN(Number(subtitle.dur)),
    `${videoId}: subtitle.dur must be a numeric string`
  );
  assert(
    typeof subtitle.text === 'string' && subtitle.text.trim().length > 0,
    `${videoId}: subtitle.text must be a non-empty string`
  );
}

async function fetchJson(url, videoId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await response.text();

    assert(
      response.ok,
      `${videoId}: expected 2xx from production API, got ${response.status} ${response.statusText}: ${body.slice(0, 500)}`
    );

    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`${videoId}: production API did not return valid JSON`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function validatePayload(payload, videoId) {
  const details = payload?.videoDetails;

  assert(
    details && typeof details === 'object',
    `${videoId}: response must include videoDetails`
  );
  assert(
    typeof details.title === 'string' && details.title.trim().length > 0,
    `${videoId}: videoDetails.title must be non-empty`
  );
  assert(
    Array.isArray(details.subtitles) && details.subtitles.length > 0,
    `${videoId}: videoDetails.subtitles must be a non-empty array`
  );

  validateSubtitle(details.subtitles[0], videoId);
  return details;
}

async function checkVideo(videoId) {
  const params = new URLSearchParams({ videoID: videoId, lang });
  const url = `${baseUrl}/api/videoDetails?${params.toString()}`;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const payload = await fetchJson(url, videoId);
      const details = validatePayload(payload, videoId);
      console.log(
        `${videoId}: OK (${details.subtitles.length} captions) - ${details.title}`
      );
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(
        `${videoId}: attempt ${attempt} failed, retrying - ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

for (const videoId of videoIds) {
  await checkVideo(videoId);
}
