import { Container, getContainer } from '@cloudflare/containers';
import { env as workerEnv } from 'cloudflare:workers';
import { Hono } from 'hono';
import { containerSlotOrderForUrl } from './worker-routing.mjs';

const app = new Hono();
const RETRYABLE_CONTAINER_STATUSES = new Set([502, 503, 504]);

export class CaptionApiContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '30m';
  enableInternet = true;
  envVars = {
    NODE_ENV: 'production',
    OUTBOUND_PROXY_URL: workerEnv.OUTBOUND_PROXY_URL || '',
    CACHE_TTL_SECONDS: workerEnv.CACHE_TTL_SECONDS || '21600',
    EXTRACTION_ATTEMPTS: workerEnv.EXTRACTION_ATTEMPTS || '4',
    EXTRACTION_RETRY_BASE_DELAY_MS:
      workerEnv.EXTRACTION_RETRY_BASE_DELAY_MS || '300',
    ALLOWED_ORIGINS: workerEnv.ALLOWED_ORIGINS || '*',
  };
}

function instanceCountFor(c) {
  const instanceCount = Number.parseInt(c.env.API_INSTANCE_COUNT || '2', 10);
  return Number.isFinite(instanceCount) && instanceCount > 0
    ? instanceCount
    : 1;
}

function getCaptionApiContainer(c, instanceSlot) {
  const containerVersion = c.env.CONTAINER_VERSION || 'default';
  return getContainer(
    c.env.CAPTION_API,
    `${containerVersion}-${instanceSlot}`
  );
}

async function proxyToContainer(c) {
  const slots = containerSlotOrderForUrl(c.req.url, instanceCountFor(c));
  const requestPath = new URL(c.req.url).pathname;
  let lastError;

  for (let i = 0; i < slots.length; i += 1) {
    try {
      const container = getCaptionApiContainer(c, slots[i]);
      const response = await container.fetch(new Request(c.req.raw));

      if (
        !requestPath.startsWith('/api/') ||
        !RETRYABLE_CONTAINER_STATUSES.has(response.status) ||
        i === slots.length - 1
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (i === slots.length - 1) throw error;
    }
  }

  throw lastError || new Error('Caption API container unavailable');
}

async function requireApiToken(c, next) {
  const expectedToken = c.env.CAPTION_API_TOKEN;

  if (!expectedToken) {
    return c.json(
      {
        code: 'auth_misconfigured',
        message: 'CAPTION_API_TOKEN is not configured',
      },
      500
    );
  }

  const authorization = c.req.header('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';

  if (token !== expectedToken) {
    c.header('WWW-Authenticate', 'Bearer');
    return c.json({ code: 'unauthorized', message: 'Unauthorized' }, 401);
  }

  await next();
}

function methodNotAllowed(c) {
  return c.json({ code: 'method_not_allowed', message: 'Use GET' }, 405);
}

app.get('/', (c) =>
  c.json({
    service: 'youtube-caption-extractor-api',
    runtime: 'cloudflare-worker+hono',
    backend: 'cloudflare-container+hono',
    endpoints: ['/health', '/api/subtitles', '/api/videoDetails'],
  })
);

app.use('/health', requireApiToken);
app.use('/api/*', requireApiToken);

app.get('/health', proxyToContainer);
app.get('/api/*', proxyToContainer);
app.all('/health', methodNotAllowed);
app.all('/api/*', methodNotAllowed);

app.notFound((c) => c.json({ code: 'not_found', message: 'Not found' }, 404));

export default app;
