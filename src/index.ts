import he from 'he';
import striptags from 'striptags';

// Universal logger that works in all environments (Node.js, Cloudflare Workers, etc.)
const createLogger = (namespace: string) => {
  const isDebugEnabled = () => {
    try {
      const env =
        typeof process !== 'undefined' && process.env ? process.env : {};
      const debugEnv = env.DEBUG || '';
      return debugEnv === '*' || debugEnv.includes(namespace);
    } catch {
      return false;
    }
  };

  return (message: string, ...args: any[]) => {
    if (isDebugEnabled()) {
      const timestamp = new Date().toISOString();
      const logMessage = `${timestamp} ${namespace} ${message}`;
      if (args.length > 0) {
        console.log(logMessage, ...args);
      } else {
        console.log(logMessage);
      }
    }
  };
};

const debug = createLogger('youtube-caption-extractor');

export interface Subtitle {
  start: string;
  dur: string;
  text: string;
}

export interface Options {
  videoID: string;
  lang?: string;
  /**
   * Custom fetch implementation. Useful for routing requests through a
   * residential proxy (undici's ProxyAgent, node-fetch + https-proxy-agent, etc.)
   * when deploying to environments where YouTube blocks datacenter IPs
   * (Vercel, AWS Lambda, Cloudflare Workers). Defaults to global fetch.
   */
  fetch?: typeof fetch;
}

export interface VideoDetails {
  title: string;
  description: string;
  subtitles: Subtitle[];
}

interface CaptionTrack {
  baseUrl: string;
  vssId?: string;
  languageCode?: string;
  kind?: string;
}

interface PlayerResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
  videoDetails?: {
    title?: string;
    shortDescription?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

// InnerTube client profiles, tried in order until one returns playable data
// with caption tracks. IOS is first because it's the most reliable client
// when YouTube isn't actively filtering the source IP; ANDROID_VR and MWEB
// follow as fallbacks with slightly different fingerprints.
//
// TVHTML5_SIMPLY_EMBEDDED_PLAYER v2.0 used to lead the chain but as of
// v1.10.1 it's been removed — direct InnerTube probes (May 2026, see
// docs/PR notes) showed YouTube globally rejects it with "no longer
// supported in this application or device" regardless of source IP.
//
// When CI's nightly canary starts failing, the typical fix is to bump
// clientVersion strings to current values (track yt-dlp's recent commits).
interface ClientProfile {
  name: string;
  clientName: string;
  clientVersion: string;
  clientNameHeader: string;
  userAgent: string;
  context: Record<string, unknown>;
}

const CLIENT_PROFILES: ClientProfile[] = [
  {
    name: 'ios',
    clientName: 'IOS',
    clientVersion: '20.10.4',
    clientNameHeader: '5',
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    context: {
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      platform: 'MOBILE',
      osName: 'iOS',
      osVersion: '18.3.2.22D82',
    },
  },
  {
    name: 'android_vr',
    clientName: 'ANDROID_VR',
    clientVersion: '1.62.20',
    clientNameHeader: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.62.20 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    context: {
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      platform: 'MOBILE',
      osName: 'Android',
      osVersion: '12L',
      androidSdkVersion: 32,
    },
  },
  {
    name: 'mweb',
    clientName: 'MWEB',
    clientVersion: '2.20251209.01.00',
    clientNameHeader: '2',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    context: {
      platform: 'MOBILE',
      osName: 'iOS',
      osVersion: '17.5.1',
    },
  },
];

const INNERTUBE_ENDPOINT =
  'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false';

async function fetchPlayerWithClient(
  videoID: string,
  client: ClientProfile,
  fetchImpl: typeof fetch
): Promise<PlayerResponse> {
  const body = {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: 'en',
        gl: 'US',
        ...client.context,
      },
      user: { lockedSafetyMode: false },
      request: { useSsl: true },
    },
    videoId: videoID,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  debug(`Calling InnerTube /player with ${client.name} client`);

  const response = await fetchImpl(INNERTUBE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      'User-Agent': client.userAgent,
      'X-YouTube-Client-Name': client.clientNameHeader,
      'X-YouTube-Client-Version': client.clientVersion,
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `InnerTube /player failed (${client.name}): ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as PlayerResponse;
}

// Try every client in order. Return the first response that has captionTracks;
// fall back to the first OK response (so getVideoDetails still gets title/desc);
// throw a combined error only if every client fails.
//
// We do NOT bail early on individual error statuses. YouTube uses the same
// `ERROR` status for both "video is private/deleted" *and* "this client
// version is too old" — and different clients see different states for the
// same video. Trying them all is cheap and the only reliable signal that a
// video is truly inaccessible is when no client returns OK.
async function fetchPlayer(
  videoID: string,
  fetchImpl: typeof fetch
): Promise<PlayerResponse> {
  let firstPlayable: PlayerResponse | null = null;
  const failures: string[] = [];

  for (const client of CLIENT_PROFILES) {
    try {
      const data = await fetchPlayerWithClient(videoID, client, fetchImpl);
      const status = data.playabilityStatus?.status;
      debug(`${client.name} client returned playabilityStatus=${status}`);

      if (status && status !== 'OK') {
        const reason = data.playabilityStatus?.reason;
        failures.push(
          `${client.name}: ${status}${reason ? ` - ${reason}` : ''}`
        );
        continue;
      }

      if (!firstPlayable) firstPlayable = data;
      const tracks =
        data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        return data;
      }
      failures.push(`${client.name}: OK but no caption tracks`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${client.name}: ${msg}`);
      debug(`${client.name} client error: ${msg}`);
    }
  }

  if (firstPlayable) return firstPlayable;
  throw new Error(
    `Video not playable on any client. Attempts:\n${failures.join('\n')}`
  );
}

function pickCaptionTrack(
  tracks: CaptionTrack[],
  lang: string
): CaptionTrack | null {
  if (!tracks.length) return null;
  return (
    tracks.find((t) => t.vssId === `.${lang}`) || // manual captions in requested lang
    tracks.find((t) => t.vssId === `a.${lang}`) || // auto-generated in requested lang
    tracks.find((t) => t.languageCode === lang) ||
    tracks.find((t) => t.vssId?.includes(`.${lang}`)) ||
    tracks[0]
  );
}

interface Json3Segment {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Segment[];
  aAppend?: number;
}

interface Json3Transcript {
  events?: Json3Event[];
}

async function fetchCaptionTrack(
  track: CaptionTrack,
  fetchImpl: typeof fetch
): Promise<Subtitle[]> {
  // Force json3 — structured, stable across edge cases, no regex parsing needed
  let url = track.baseUrl.replace(/&fmt=[^&]+/, '');
  url += '&fmt=json3';

  debug(`Fetching caption track from ${url.split('?')[0]}?…`);

  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': CLIENT_PROFILES[0].userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Caption fetch failed: ${response.status}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error('Caption response contained no subtitles');
  }

  let data: Json3Transcript;
  try {
    data = JSON.parse(text) as Json3Transcript;
  } catch {
    throw new Error('Caption response was not valid JSON');
  }

  const events = data.events ?? [];
  const subtitles: Subtitle[] = [];

  for (const event of events) {
    if (!event.segs || event.aAppend === 1) continue;
    const raw = event.segs.map((s) => s.utf8 ?? '').join('');
    const text = he.decode(striptags(raw)).trim();
    if (!text) continue;
    const startMs = event.tStartMs ?? 0;
    const durMs = event.dDurationMs ?? 0;
    subtitles.push({
      start: (startMs / 1000).toString(),
      dur: (durMs / 1000).toString(),
      text,
    });
  }

  debug(`Parsed ${subtitles.length} caption events from json3`);
  if (subtitles.length === 0) {
    throw new Error('Caption response contained no subtitles');
  }
  return subtitles;
}

async function extractSubtitles(
  playerData: PlayerResponse,
  lang: string,
  fetchImpl: typeof fetch
): Promise<Subtitle[]> {
  const tracks =
    playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    debug('No caption tracks available on this video');
    return [];
  }

  const track = pickCaptionTrack(tracks, lang);
  if (!track?.baseUrl) {
    debug(`No matching caption track for lang=${lang}`);
    return [];
  }

  debug(`Selected caption track: ${track.vssId ?? track.languageCode}`);
  return fetchCaptionTrack(track, fetchImpl);
}

export const getSubtitles = async ({
  videoID,
  lang = 'en',
  fetch: customFetch,
}: Options): Promise<Subtitle[]> => {
  const fetchImpl = customFetch ?? fetch;
  debug(`getSubtitles videoID=${videoID} lang=${lang}`);
  const playerData = await fetchPlayer(videoID, fetchImpl);
  return extractSubtitles(playerData, lang, fetchImpl);
};

export const getVideoDetails = async ({
  videoID,
  lang = 'en',
  fetch: customFetch,
}: Options): Promise<VideoDetails> => {
  const fetchImpl = customFetch ?? fetch;
  debug(`getVideoDetails videoID=${videoID} lang=${lang}`);
  const playerData = await fetchPlayer(videoID, fetchImpl);

  const title = playerData.videoDetails?.title ?? 'No title found';
  const description =
    playerData.videoDetails?.shortDescription ?? 'No description found';

  const subtitles = await extractSubtitles(playerData, lang, fetchImpl);

  return { title, description, subtitles };
};
