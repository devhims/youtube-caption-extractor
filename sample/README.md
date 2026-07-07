# YouTube Caption Extractor Demo

This is a Next.js project demonstrating the use of the `youtube-caption-extractor` npm package. It allows users to fetch subtitles and video details from YouTube videos using this package.

## Features

- Fetch subtitles from YouTube videos
- Retrieve video details including title and description
- Support for multiple languages

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). By default, the UI calls the local Next.js API routes.

The API app lives in `server/` and can be run separately from Next.js.

For the fastest local loop, run the Hono API directly and point the Next.js API routes at it:

```bash
npm --prefix server install
npm run api:dev
CAPTION_API_BASE_URL=http://localhost:8080 npm run dev
```

To test the full local Worker → Cloudflare Container path, run Wrangler with Docker and point the Next.js API routes at Wrangler:

```bash
npm --prefix server install
npm run cf:dev
CAPTION_API_BASE_URL=http://localhost:8787 CAPTION_API_TOKEN=<token> npm run dev
```

Cloudflare dashboard "live instances" only reflects deployed Cloudflare traffic. It does not change when testing the local Hono API or local Wrangler container.

## Cloudflare container API

This sample includes a self-contained Cloudflare Containers app in `server/`. It runs the API as a Dockerized Hono Node server and proxies requests through a Hono Worker.

```bash
npm --prefix server install
npm run cf:deploy
```

After deploy, set Vercel/Next.js server-side environment variables to the Worker URL and shared API token:

```bash
CAPTION_API_BASE_URL=https://<your-worker>.<your-subdomain>.workers.dev
CAPTION_API_TOKEN=<same-token-configured-on-the-worker>
```

Do not put `CAPTION_API_TOKEN` in a `NEXT_PUBLIC_*` variable. The browser calls the Next.js API routes, and the Next.js server attaches the token when it calls the Worker.

The container endpoint supports:

- `GET /health`
- `GET /api/subtitles?videoID=<id>&lang=en`
- `GET /api/videoDetails?videoID=<id>&lang=en`

Optional runtime environment variables:

- `CAPTION_API_TOKEN` — shared bearer token required by the Worker before it proxies to the container.
- `OUTBOUND_PROXY_URL` — routes YouTube requests through an HTTP(S) proxy via `undici`.
- `CACHE_TTL_SECONDS` — controls the warm in-memory response cache, default `21600`.
- `EXTRACTION_ATTEMPTS` — retries transient YouTube egress failures inside the container, default `4`.
- `EXTRACTION_RETRY_BASE_DELAY_MS` — linear retry backoff base delay, default `300`.
- `ALLOWED_ORIGINS` — comma-separated browser origins for CORS, default `*`.
- `CONTAINER_VERSION` — version prefix for container instance names; bump it to force fresh instances during rollouts.

From `server/`, use `npx wrangler secret put CAPTION_API_TOKEN` to set the shared token on Cloudflare.
From `server/`, use `npx wrangler secret put OUTBOUND_PROXY_URL` if the proxy URL contains credentials.

If the API returns `youtube_blocked_datacenter_ip`, the request reached the Cloudflare container but YouTube blocked the container's outbound datacenter IP. Use direct local API testing (`http://localhost:8080`) for local machine egress, or configure `OUTBOUND_PROXY_URL` with a trusted proxy for deployed Cloudflare container testing.

## Usage

1. Enter the YouTube video ID in the "Video ID" field.
2. Specify the desired language code in the "Language" field (e.g., 'en', 'es', 'fr') or leave it empty.
3. Click "Fetch Data" to retrieve the subtitles and video details.
