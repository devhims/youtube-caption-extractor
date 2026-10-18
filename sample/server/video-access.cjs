// The library combines failures from all clients. Classify explicit membership
// restrictions before the generic "not playable" wrapper or bot-challenge text.
function getVideoAccessError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/\bmembers[-\s]+only\b|available to this channel['’]s members\b/i.test(message)) {
    return null;
  }

  return {
    status: 403,
    body: {
      code: 'video_access_restricted',
      reason: 'members_only',
      message: 'This video is members-only and requires the appropriate channel membership. This API cannot access its captions.',
    },
  };
}

module.exports = { getVideoAccessError };
