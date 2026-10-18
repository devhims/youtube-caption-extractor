import { describe, expect, test } from 'vitest';
import { handleApiError } from './handleError';

describe('direct extraction errors', () => {
  test('returns a permanent, uncached membership error before generic bot detection', async () => {
    const response = handleApiError(new Error("Video not playable on any client. Attempts:\nios: UNPLAYABLE - This video is available to this channel's members on level: SCG SUPERFAN\nmweb: LOGIN_REQUIRED - Sign in to confirm you are not a bot"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'video_access_restricted', reason: 'members_only',
      message: expect.stringContaining('members-only'),
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('keeps genuine bot challenges retryable', async () => {
    const response = handleApiError(new Error('mweb: LOGIN_REQUIRED - Sign in to confirm you are not a bot'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'youtube_blocked_datacenter_ip' });
  });
});
