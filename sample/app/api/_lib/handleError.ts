import { NextResponse } from 'next/server';
import { getVideoAccessError } from '../../../server/video-access.cjs';

/**
 * Maps explicit membership restrictions to permanent 403 responses before
 * handling bot challenges as transient 503 responses. Both can arrive inside
 * the library's generic "Video not playable on any client" error.
 */
export function handleApiError(error: unknown): NextResponse {
  const accessError = getVideoAccessError(error);
  if (accessError) {
    return NextResponse.json(accessError.body, {
      status: accessError.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const message = error instanceof Error ? error.message : String(error);

  const looksLikeBotChallenge =
    message.includes('LOGIN_REQUIRED') ||
    message.includes('not a bot') ||
    message.includes('no longer supported') ||
    message.includes('Video not playable on any client');

  if (looksLikeBotChallenge) {
    return NextResponse.json(
      {
        code: 'youtube_blocked_datacenter_ip',
        message:
          'YouTube is blocking this server egress. Cloud/container hosts often use shared datacenter IP ranges that YouTube gates with a bot challenge. If this persists on Cloudflare Containers, route outbound YouTube requests through the library `fetch` option using a trusted proxy.',
        debug: message,
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { code: 'unknown_error', message },
    { status: 500 }
  );
}
