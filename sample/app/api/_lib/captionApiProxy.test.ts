import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as detailsRoute from '../videoDetails/route';
import * as subtitlesRoute from '../subtitles/route';
import { proxyCaptionApi } from './captionApiProxy';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('CAPTION_API_BASE_URL', 'https://caption-api.example.test');
  vi.stubEnv('CAPTION_API_TOKEN', 'test-token');
  vi.stubEnv('CAPTION_API_PROXY_ATTEMPTS', '3');
  vi.stubEnv('CAPTION_API_PROXY_TIMEOUT_MS', '50000');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each([
  ['videoDetails', detailsRoute],
  ['subtitles', subtitlesRoute],
] as const)('%s route', (path, route) => {
  test('forwards a backend membership restriction without proxy retries', async () => {
    const body = {
      code: 'video_access_restricted',
      reason: 'members_only',
      message: 'This video is members-only and requires the appropriate channel membership. This API cannot access its captions.',
    };
    const fetchMock = vi.fn(async () => Response.json(body, {
      status: 403, headers: { 'cache-control': 'no-store' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await route.GET(new NextRequest(`https://example.test/api/${path}?videoID=hswC9ZW7r0g&lang=en`));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('allows a slow backend retry to succeed beyond the former 10-second limit', async () => {
    expect((route as { maxDuration?: number }).maxDuration).toBe(60);
    const payload = path === 'videoDetails'
      ? { videoDetails: { title: 'Test video', subtitles: [{ start: '0', dur: '1', text: 'Hello' }] } }
      : { subtitles: [{ start: '0', dur: '1', text: 'Hello' }] };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        setTimeout(() => resolve(new Response('unavailable', { status: 503 })), 11309);
      }))
      .mockResolvedValueOnce(Response.json(payload, { headers: { 'x-cache': 'MISS' } }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest(`https://example.test/api/${path}?videoID=0Gb1z-2SjHY&lang=en`);
    const result = route.GET(request);
    await vi.advanceTimersByTimeAsync(11309);
    const response = await result;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.get('authorization')).toBe('Bearer test-token');
    expect(vi.getTimerCount()).toBe(0);
  });
});

test('aborts a stuck upstream request within one total retry budget', async () => {
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve(new Response('unavailable', { status: 503 })), 20000);
    }))
    .mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
  vi.stubGlobal('fetch', fetchMock);
  let response: Response | null | undefined;
  void proxyCaptionApi('/api/videoDetails', new URLSearchParams({ videoID: 'test' }))
    .then((value) => { response = value; });

  await vi.advanceTimersByTimeAsync(50000);

  expect(response?.status).toBe(504);
  expect(await response?.json()).toMatchObject({ code: 'caption_api_timeout' });
  expect(response?.headers.get('cache-control')).toBe('no-store');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('keeps the deadline active while reading a stalled response body', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  }))));
  let response: Response | null | undefined;
  void proxyCaptionApi('/api/subtitles', new URLSearchParams({ videoID: 'test' }))
    .then((value) => { response = value; });

  await vi.advanceTimersByTimeAsync(50000);

  expect(response?.status).toBe(504);
  expect(await response?.json()).toMatchObject({ code: 'caption_api_timeout' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('honors a shorter configured deadline', async () => {
  vi.stubEnv('CAPTION_API_PROXY_TIMEOUT_MS', '1000');
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })));
  const result = proxyCaptionApi('/api/subtitles', new URLSearchParams({ videoID: 'test' }));
  await vi.advanceTimersByTimeAsync(1000);
  expect((await result)?.status).toBe(504);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(['NaN', 'Infinity', '0', '-1', '999999'])('keeps unsafe timeout %s below the function duration', async (timeout) => {
  vi.stubEnv('CAPTION_API_PROXY_TIMEOUT_MS', timeout);
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })));
  let response: Response | null | undefined;
  void proxyCaptionApi('/api/subtitles', new URLSearchParams({ videoID: 'test' }))
    .then((value) => { response = value; });
  await vi.advanceTimersByTimeAsync(50000);
  expect(response?.status).toBe(504);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('preserves upstream failures after retries are exhausted', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', {
    status: 503, headers: { 'cache-control': 'no-store' },
  })));
  const response = await proxyCaptionApi('/api/videoDetails', new URLSearchParams({ videoID: 'test' }));
  expect(response?.status).toBe(503);
  expect(await response?.text()).toBe('unavailable');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

test('returns the existing unreachable error after connection failures', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
  const response = await proxyCaptionApi('/api/videoDetails', new URLSearchParams({ videoID: 'test' }));
  expect(response?.status).toBe(502);
  expect(await response?.json()).toMatchObject({ code: 'caption_api_unreachable' });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

test('keeps direct local extraction available without a configured backend', async () => {
  vi.stubEnv('CAPTION_API_BASE_URL', '');
  vi.stubGlobal('fetch', vi.fn());
  expect(await proxyCaptionApi('/api/subtitles', new URLSearchParams())).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
