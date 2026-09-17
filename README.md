<div align="center">
  <h1>youtube-caption-extractor</h1>
  <p><strong>Turn public YouTube videos into clean, timestamped transcripts.</strong></p>
  <p>
    Extract YouTube captions, subtitles, auto-generated transcripts, and video metadata
    with a tiny TypeScript library: ~10.8 kB packed, ~31.1 kB unpacked.
  </p>
  <p>
    <a href="https://www.npmjs.com/package/youtube-caption-extractor"><img alt="npm version" src="https://img.shields.io/npm/v/youtube-caption-extractor?color=cb3837"></a>
    <a href="https://www.npmjs.com/package/youtube-caption-extractor"><img alt="npm downloads" src="https://img.shields.io/npm/dm/youtube-caption-extractor"></a>
    <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/youtube-caption-extractor"></a>
    <a href="https://www.typescriptlang.org/"><img alt="TypeScript ready" src="https://img.shields.io/badge/TypeScript-ready-3178c6"></a>
    <a href="https://nodejs.org/"><img alt="Node.js 18+" src="https://img.shields.io/badge/Node.js-18%2B-43853d"></a>
  </p>
  <p>
    <a href="#try-it-quickly">Quickstart</a>
    · <a href="https://youtube-caption-extractor.vercel.app/">Live demo</a>
    · <a href="./sample">Sample app</a>
    · <a href="#api">API</a>
    · <a href="#deployment-notes">Deployment notes</a>
  </p>
</div>

---

## Why use it?

- **One-call transcript extraction** — `getSubtitles()` returns timestamped segments ready for search, summarization, indexing, RAG, slide ready research notes, or export.
- **Metadata included** — `getVideoDetails()` returns title, description, and captions in one response.
- **Manual + auto captions** — prefers exact language matches, then gracefully falls back to available tracks.
- **Tiny install** — ~10.8 kB packed on npm, with only two runtime dependencies.
- **Runtime-friendly** — uses global `fetch`, with an optional custom transport for retries, caching, regional routing, or proxies.
- **Production-aware sample** — includes a Next.js demo plus a token-protected Cloudflare Container API.

## Built for

- YouTube caption extraction, subtitle extraction, and timestamped transcript data.
- AI summaries, search indexes, RAG pipelines, and agent workflows that need clean video text.
- Slide ready notes, presentation research, and content workflows built from public YouTube videos.
- Lightweight video metadata enrichment without pulling in a large SDK.

```ts
import { getSubtitles } from 'youtube-caption-extractor';

const subtitles = await getSubtitles({ videoID: '7GeFt8suV8E', lang: 'en' });
// → [
//     { start: '1.12', dur: '4.56', text: 'This scraper can scrape almost anything' },
//     { start: '3.36', dur: '5.84', text: 'on the internet and you will be' },
//     { start: '5.68', dur: '6.64', text: 'surprised how easy it is to use it.' },
//     ...
//   ]
```

## Try it quickly

```sh
npm install youtube-caption-extractor
```

```ts
import { getVideoDetails } from 'youtube-caption-extractor';

const video = await getVideoDetails({
  videoID: '7GeFt8suV8E',
  lang: 'en',
});

console.log(video.title);
console.log(video.subtitles.map((s) => s.text).join('\n'));
```

Want to click around first? Try the hosted demo:
[youtube-caption-extractor.vercel.app](https://youtube-caption-extractor.vercel.app/).

Want a full app example? See [`sample/`](./sample), which includes:

- A polished Next.js UI
- Local API testing with your machine's network egress
- A Dockerized Hono API deployed through Cloudflare Containers
- A server-side token-protected proxy so the container API is not publicly open

## Installation

```sh
npm install youtube-caption-extractor
```

Requires **Node.js ≥ 18** when running on Node.js because the library uses the
global `fetch` API. It also works in Bun, Deno, Cloudflare Workers, and other
modern JavaScript runtimes that provide `fetch`. See
[Deployment notes](#deployment-notes) for tips on keeping calls reliable from
your runtime of choice.

## API

The library exports two functions and three types.

### `getSubtitles({ videoID, lang?, fetch? })`

Returns the caption track as an array of timed segments.

| Param     | Type           | Default        | Notes                                                                                                                                                            |
| --------- | -------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `videoID` | `string`       | (required)     | The 11-character YouTube video ID, e.g. `7GeFt8suV8E`. Not the full URL.                                                                                         |
| `lang`    | `string`       | `'en'`         | ISO language code (`'en'`, `'es'`, `'fr'`, `'ja'`, …). Manual captions are preferred over auto-generated, and an exact match is preferred over a partial match.  |
| `fetch`   | `typeof fetch` | global `fetch` | Custom fetch implementation. Useful for adding caching, custom retries, or routing through a proxy. See [Customizing the transport](#customizing-the-transport). |

Resolves to `Subtitle[]`. Returns an empty array if the video plays but has no caption track in the requested language. **Throws** if the video is unavailable on any extraction path (see [Error handling](#error-handling)).

### `getVideoDetails({ videoID, lang?, fetch? })`

Same arguments as `getSubtitles`. Returns title, description, and the same subtitle array:

```ts
const details = await getVideoDetails({ videoID: '7GeFt8suV8E', lang: 'en' });
// → {
//     title: 'Master Web Scraping with Firecrawl!',
//     description: 'Get started with Firecrawl here: https://firecrawl.link/…',
//     subtitles: [{ start: '1.12', dur: '4.56', text: 'This scraper can scrape almost anything' }, …],
//   }
```

If the video has no caption tracks, the call resolves with metadata and an empty `subtitles` array. If a caption track exists but fetching or parsing it fails, the call rejects so callers can retry. An empty response from an advertised caption track is also an error. This changes the previous behavior, which silently returned empty subtitles on extraction failures.

### Types

```ts
interface Subtitle {
  start: string; // Segment start time, seconds
  dur: string; // Segment duration, seconds
  text: string; // Decoded text content
}

interface VideoDetails {
  title: string;
  description: string;
  subtitles: Subtitle[];
}

interface Options {
  videoID: string;
  lang?: string;
  fetch?: typeof fetch;
}
```

All three are exported by name and can be imported directly:

```ts
import type {
  Subtitle,
  VideoDetails,
  Options,
} from 'youtube-caption-extractor';
```

## Languages

The `lang` argument is a hint, not a strict filter. Track selection precedence:

1. **Manual captions in the requested language** (`vssId === '.<lang>'`)
2. **Auto-generated captions in the requested language** (`vssId === 'a.<lang>'`)
3. **Any track whose `languageCode` matches** the requested code
4. **Any track whose `vssId` contains the requested code** (partial match)
5. **The first available track** as a final fallback

If you pass `lang: 'en'` and the video only has Spanish manual captions, you'll get those — the library prefers _some_ output over none. If you pass a code that doesn't exist on the video, you'll typically get the video's primary language track. To check whether you got what you asked for, inspect the first segment's text or compare against `VideoDetails.title` / `description`.

## Error handling

The library throws a regular `Error` when no extraction path succeeds — for instance, when the video is private, deleted, or YouTube didn't return a usable response.

The error message has a stable, parseable structure listing each client that was attempted along with the status YouTube returned for it:

```
Video not playable on any client. Attempts:
ios: LOGIN_REQUIRED - Sign in to confirm you're not a bot
android_vr: LOGIN_REQUIRED - Sign in to confirm you're not a bot
mweb: LOGIN_REQUIRED - Sign in to confirm you're not a bot
```

A common pattern for classifying errors and surfacing them gracefully:

```ts
try {
  const subtitles = await getSubtitles({ videoID, lang });
  return subtitles;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('LOGIN_REQUIRED') || msg.includes('not a bot')) {
    // Transient — usually worth retrying. See "Deployment notes" for details.
    throw new Error('transient_extraction_failure');
  }
  if (msg.includes('Video unavailable') || msg.includes('private')) {
    throw new Error('video_not_accessible');
  }
  throw err;
}
```

## Deployment notes

The library calls YouTube directly, so reliability depends partly on the network
egress of the process making the request.

Local development and self-hosted servers tend to work out of the box. Shared
serverless, container, and edge IP ranges can sometimes be rate-limited or gated
by YouTube's bot checks. That is not a library API issue; it is an egress
reputation issue. For production, use the patterns below.

### Recommended app architecture

Keep YouTube extraction server-side. Do not call YouTube directly from browser
code.

```txt
Browser → your app API route → youtube-caption-extractor → YouTube
```

If you use a separate API service, protect it with a server-side token:

```txt
Browser → your app API route → token-protected caption API → YouTube
```

The included [`sample/`](./sample) demonstrates this pattern with:

- Next.js API routes as the public browser-facing API
- A Cloudflare Worker that rejects requests without `Authorization: Bearer <token>`
- A Cloudflare Container running a Hono/Node API
- `CAPTION_API_TOKEN` kept server-side only, never in `NEXT_PUBLIC_*`

### Building resilient calls

A small retry wrapper handles transient failures gracefully:

```ts
import { getSubtitles, type Subtitle } from 'youtube-caption-extractor';

async function getSubtitlesWithRetry(
  videoID: string,
  lang = 'en',
  maxAttempts = 3,
): Promise<Subtitle[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await getSubtitles({ videoID, lang });
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Don't retry on permanent errors (private/deleted video, etc.)
      if (msg.includes('Video unavailable') || msg.includes('private')) {
        throw err;
      }
      // Small backoff between attempts
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  throw lastError;
}
```

### Customizing the transport

The optional `fetch` argument lets you supply any custom transport — useful for adding caching, custom headers, regional routing, or proxying through another service:

```ts
import { getSubtitles } from 'youtube-caption-extractor';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const dispatcher = new ProxyAgent(process.env.OUTBOUND_PROXY_URL!);

const proxied: typeof fetch = (input, init) =>
  undiciFetch(input, { ...init, dispatcher }) as unknown as Promise<Response>;

const subtitles = await getSubtitles({
  videoID: '7GeFt8suV8E',
  lang: 'en',
  fetch: proxied,
});
```

Common uses for a custom `fetch`:

- **Caching layers** — wrap the global fetch with an LRU or in-memory cache
- **Authenticated proxies** — add `Authorization` headers via a wrapper
- **Regional routing** — direct outbound traffic through a specific region or provider

### Local vs hosted behavior

If extraction works locally but fails in a hosted environment with a message like
`LOGIN_REQUIRED` or "Sign in to confirm you're not a bot", the hosted provider's
egress IP is likely being challenged by YouTube. Your options are:

1. Run the extraction API somewhere with reliable egress for your workload.
2. Use the `fetch` option to route outbound YouTube requests through a trusted proxy.
3. Cache successful results aggressively so fewer requests reach YouTube.
4. Treat these failures as transient and retry with backoff where appropriate.

## Usage examples

### Next.js (App Router)

```ts
// app/api/captions/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getVideoDetails } from 'youtube-caption-extractor';

export async function GET(request: NextRequest) {
  const videoID = request.nextUrl.searchParams.get('videoID');
  const lang = request.nextUrl.searchParams.get('lang') ?? 'en';

  if (!videoID) {
    return NextResponse.json({ error: 'Missing videoID' }, { status: 400 });
  }

  try {
    const details = await getVideoDetails({ videoID, lang });
    return NextResponse.json(details);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

Call from a client component with `fetch('/api/captions?videoID=...')`. This avoids the browser CORS issue and keeps the YouTube call server-side.

### Express

```ts
import express from 'express';
import { getSubtitles } from 'youtube-caption-extractor';

const app = express();

app.get('/captions/:videoID', async (req, res) => {
  try {
    const subtitles = await getSubtitles({
      videoID: req.params.videoID,
      lang: (req.query.lang as string) ?? 'en',
    });
    res.json({ subtitles });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

### Cloudflare Workers

```ts
import { getSubtitles } from 'youtube-caption-extractor';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const videoID = url.searchParams.get('videoID');
    if (!videoID) return new Response('Missing videoID', { status: 400 });

    try {
      const subtitles = await getSubtitles({ videoID, lang: 'en' });
      return Response.json({ subtitles });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  },
};
```

Add `compatibility_flags: ["nodejs_compat"]` in your `wrangler.jsonc` so the library's `he` and `striptags` dependencies resolve. For production workloads, wrap the call in the retry helper from [Building resilient calls](#building-resilient-calls).

## Debug logging

The library is silent by default. To see what's happening internally — which client returned what, where it fell back, what URL was hit — set the `DEBUG` env var:

```sh
DEBUG=youtube-caption-extractor node your-script.js

# Cloudflare Workers
DEBUG=youtube-caption-extractor wrangler dev

# Or DEBUG=* for everything
```

The logger uses only `console.log` and `process.env` (read defensively), so it works in any runtime that provides those — no `debug` package dependency.

## TypeScript

The package ships type definitions; no `@types/*` install needed. All three types (`Subtitle`, `VideoDetails`, `Options`) are exported:

```ts
import {
  getSubtitles,
  getVideoDetails,
  type Subtitle,
  type VideoDetails,
  type Options,
} from 'youtube-caption-extractor';

async function transcript(opts: Options): Promise<Subtitle[]> {
  return await getSubtitles(opts);
}
```

## Changelog

### v1.10.2

- Added a production-ready sample API path using a Dockerized Hono server on Cloudflare Containers.
- Added server-side token protection for the sample Cloudflare Worker API.
- Updated the sample app so browser requests go through Next.js API routes instead of exposing API secrets client-side.
- Refreshed README quickstart and deployment guidance to make local testing, hosted demos, and production egress tradeoffs clearer.

### v1.10.1

- **Streamlined the internal client fallback chain.** Removed an outdated client that was no longer contributing successful extractions, and reordered the remaining clients with the most reliable one first.
- **Faster successful calls** — one fewer round-trip in the common case (~150 ms saved per request).
- No API changes; fully backward-compatible.

### v1.10.0

- Caption extraction is reliable again — fixes a regression where `getSubtitles` would silently return `[]` for many videos.
- Multi-path extraction with automatic fallback across clients; gracefully degrades when one path is unavailable.
- json3-based subtitle parser replaces the legacy XML regex, fixing multi-line and special-character edge cases.
- New optional `fetch` option for routing through a residential proxy.
- `Options` interface now exported.
- `engines.node` bumped to `>=18.0.0`.
- Slimmer install — published tarball is ~85% smaller.

### v1.9.0

- `Subtitle` interface exported.
- Universal debug logger that works in Node.js, Cloudflare Workers, and edge runtimes.
- Library is silent by default in production.

### v1.4.2

- TypeScript definitions shipped with the package.
- Node.js and edge runtime support.
- New `getVideoDetails` API for title + description + subtitles in one call.

## License

[MIT](./LICENSE)
