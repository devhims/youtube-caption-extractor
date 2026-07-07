export function routingKeyFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const videoID = url.searchParams.get('videoID') || '';
    const lang = url.searchParams.get('lang') || 'en';

    if (url.pathname.startsWith('/api/')) {
      return `${url.pathname}:${videoID}:${lang}`;
    }

    return url.pathname;
  } catch {
    return rawUrl;
  }
}

function stableHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function containerSlotOrderForUrl(rawUrl, instanceCount) {
  const count = Math.max(1, Math.floor(Number(instanceCount) || 1));
  const primary = stableHash(routingKeyFromUrl(rawUrl)) % count;
  const slots = [primary];

  for (let offset = 1; offset < count; offset += 1) {
    slots.push((primary + offset) % count);
  }

  return slots;
}
