import { NextResponse } from 'next/server';

const PROXY_HEADERS = ['content-type', 'cache-control', 'x-cache'];
const RETRYABLE_PROXY_STATUSES = new Set([502, 503, 504]);
const MAX_PROXY_TIMEOUT_MS = 50_000;

function proxyTimeoutMs(): number {
  const configured = Number(
    process.env.CAPTION_API_PROXY_TIMEOUT_MS || MAX_PROXY_TIMEOUT_MS
  );
  if (!Number.isFinite(configured) || configured <= 0) return MAX_PROXY_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_PROXY_TIMEOUT_MS, Math.floor(configured)));
}

function proxyAttempts(): number {
  const configured = Number(process.env.CAPTION_API_PROXY_ATTEMPTS || 3);
  if (!Number.isFinite(configured)) return 3;
  return Math.max(1, Math.min(5, Math.floor(configured)));
}

function captionApiBaseUrl(): string {
  return (process.env.CAPTION_API_BASE_URL || '').replace(/\/+$/, '');
}

function captionApiToken(): string {
  return process.env.CAPTION_API_TOKEN || '';
}

export async function proxyCaptionApi(
  path: string,
  searchParams: URLSearchParams
): Promise<NextResponse | null> {
  const baseUrl = captionApiBaseUrl();
  if (!baseUrl) return null;

  const upstreamUrl = `${baseUrl}${path}?${searchParams.toString()}`;
  const token = captionApiToken();
  const headers = new Headers();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const attempts = proxyAttempts();
  // One deadline covers every attempt, including reading the response body.
  // Resetting it on retries could exceed the routes' 60-second function limit.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), proxyTimeoutMs());

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        controller.signal.throwIfAborted();
        const upstream = await fetch(upstreamUrl, {
          cache: 'no-store',
          headers,
          signal: controller.signal,
        });
        const body = await upstream.text();
        const responseHeaders = new Headers();

        for (const header of PROXY_HEADERS) {
          const value = upstream.headers.get(header);
          if (value) responseHeaders.set(header, value);
        }

        if (
          attempt < attempts &&
          RETRYABLE_PROXY_STATUSES.has(upstream.status)
        ) {
          continue;
        }

        return new NextResponse(body, {
          headers: responseHeaders,
          status: upstream.status,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return NextResponse.json(
            {
              code: 'caption_api_timeout',
              message: 'Caption API took too long to respond. Please try again.',
            },
            { status: 504, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        if (attempt < attempts) continue;
        return NextResponse.json(
          {
            code: 'caption_api_unreachable',
            message:
              error instanceof Error ? error.message : 'Caption API unreachable',
          },
          { status: 502, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return NextResponse.json(
    { code: 'caption_api_unreachable', message: 'Caption API unreachable' },
    { status: 502 }
  );
}
