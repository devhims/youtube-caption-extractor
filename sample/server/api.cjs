const { serve } = require('@hono/node-server');
const { Hono } = require('hono');
const { getSubtitles, getVideoDetails } = require('youtube-caption-extractor');

const PORT = Number(process.env.PORT || 8080);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_SECONDS || 21600) * 1000;
const SUCCESS_CACHE_CONTROL =
  process.env.SUCCESS_CACHE_CONTROL ||
  'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400';
const OUTBOUND_PROXY_URL = process.env.OUTBOUND_PROXY_URL;
const EXTRACTION_ATTEMPTS = boundedInteger(
  process.env.EXTRACTION_ATTEMPTS,
  4,
  1,
  8
);
const EXTRACTION_RETRY_BASE_DELAY_MS = boundedInteger(
  process.env.EXTRACTION_RETRY_BASE_DELAY_MS,
  300,
  0,
  5000
);

const app = new Hono();
const cache = new Map();
let extractorFetchPromise;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '*';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();

function allowOriginFor(c) {
  const origin = c.req.header('origin');
  if (allowedOrigins.includes('*') || !origin) return '*';
  return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
}

function normalizeApiError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const looksLikeBotChallenge =
    message.includes('LOGIN_REQUIRED') ||
    message.includes('not a bot') ||
    message.includes('no longer supported') ||
    message.includes('Video not playable on any client');

  if (looksLikeBotChallenge) {
    return {
      status: 503,
      body: {
        code: 'youtube_blocked_datacenter_ip',
        message:
          'YouTube is blocking this server egress. Cloud/container hosts often use shared datacenter IP ranges that YouTube gates with a bot challenge. If this persists on Cloudflare Containers, route outbound YouTube requests through the library `fetch` option using a trusted proxy.',
        debug: message,
      },
    };
  }

  return {
    status: 500,
    body: { code: 'unknown_error', message },
  };
}

function isRetryableExtractionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('private') ||
    lower.includes('video unavailable') ||
    lower.includes('this video is unavailable') ||
    lower.includes('removed by')
  ) {
    return false;
  }

  return (
    message.includes('LOGIN_REQUIRED') ||
    lower.includes('not a bot') ||
    lower.includes('no longer supported') ||
    lower.includes('video not playable on any client') ||
    lower.includes('innertube /player failed') ||
    lower.includes('caption fetch failed: 429') ||
    lower.includes('caption fetch failed: 500') ||
    lower.includes('caption fetch failed: 502') ||
    lower.includes('caption fetch failed: 503') ||
    lower.includes('caption fetch failed: 504') ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('und_err')
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withExtractionRetry(operation, options = {}) {
  const attempts = boundedInteger(
    options.attempts,
    EXTRACTION_ATTEMPTS,
    1,
    8
  );
  const baseDelayMs = boundedInteger(
    options.baseDelayMs,
    EXTRACTION_RETRY_BASE_DELAY_MS,
    0,
    5000
  );
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableExtractionError(error)) {
        throw error;
      }
      if (baseDelayMs > 0) {
        await delay(baseDelayMs * attempt);
      }
    }
  }

  throw lastError;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  if (CACHE_TTL_MS <= 0) return;
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function getExtractorFetch() {
  if (!OUTBOUND_PROXY_URL) return undefined;
  if (!extractorFetchPromise) {
    extractorFetchPromise = import('undici').then(({ ProxyAgent, fetch }) => {
      const dispatcher = new ProxyAgent(OUTBOUND_PROXY_URL);
      return (input, init) => fetch(input, { ...init, dispatcher });
    });
  }
  return extractorFetchPromise;
}

function cacheHeaders(cacheState) {
  return {
    'Cache-Control': SUCCESS_CACHE_CONTROL,
    'X-Cache': cacheState,
  };
}

function missingVideoId(c) {
  return c.json(
    { code: 'missing_video_id', message: 'Missing videoID' },
    400
  );
}

function methodNotAllowed(c) {
  return c.json({ code: 'method_not_allowed', message: 'Use GET' }, 405);
}

app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', allowOriginFor(c));
  c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  c.header('Vary', 'Origin');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
});

app.get('/health', (c) =>
  c.json({ status: 'ok', runtime: 'hono-node-container' })
);
app.all('/health', methodNotAllowed);

app.get('/api/subtitles', async (c) => {
  const videoID = c.req.query('videoID');
  const lang = c.req.query('lang') || 'en';

  if (!videoID) return missingVideoId(c);

  try {
    const cacheKey = `subtitles:${videoID}:${lang}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return c.json(cached, 200, cacheHeaders('HIT'));
    }

    const fetchImpl = await getExtractorFetch();
    const body = {
      subtitles: await withExtractionRetry(() =>
        getSubtitles({ videoID, lang, fetch: fetchImpl })
      ),
    };
    setCached(cacheKey, body);
    return c.json(body, 200, cacheHeaders('MISS'));
  } catch (error) {
    const normalized = normalizeApiError(error);
    return c.json(normalized.body, normalized.status);
  }
});
app.all('/api/subtitles', methodNotAllowed);

app.get('/api/videoDetails', async (c) => {
  const videoID = c.req.query('videoID');
  const lang = c.req.query('lang') || 'en';

  if (!videoID) return missingVideoId(c);

  try {
    const cacheKey = `videoDetails:${videoID}:${lang}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return c.json(cached, 200, cacheHeaders('HIT'));
    }

    const fetchImpl = await getExtractorFetch();
    const body = {
      videoDetails: await withExtractionRetry(() =>
        getVideoDetails({ videoID, lang, fetch: fetchImpl })
      ),
    };
    setCached(cacheKey, body);
    return c.json(body, 200, cacheHeaders('MISS'));
  } catch (error) {
    const normalized = normalizeApiError(error);
    return c.json(normalized.body, normalized.status);
  }
});
app.all('/api/videoDetails', methodNotAllowed);

app.notFound((c) => c.json({ code: 'not_found', message: 'Not found' }, 404));

app.onError((error, c) => {
  const normalized = normalizeApiError(error);
  return c.json(normalized.body, normalized.status);
});

if (require.main === module) {
  serve(
    {
      fetch: app.fetch,
      hostname: '0.0.0.0',
      port: PORT,
    },
    () => {
      console.log(`Caption API listening on :${PORT}`);
    }
  );
}

module.exports = {
  app,
  boundedInteger,
  isRetryableExtractionError,
  normalizeApiError,
  withExtractionRetry,
};
