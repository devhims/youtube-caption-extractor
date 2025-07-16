import he from 'he';
import striptags from 'striptags';

interface Subtitle {
  start: string;
  dur: string;
  text: string;
}

interface CaptionTrack {
  baseUrl: string;
  vssId: string;
}

export interface Options {
  videoID: string;
  lang?: string;
}

export interface VideoDetails {
  title: string;
  description: string;
  subtitles: Subtitle[];
}

// YouTube public API key
const FALLBACK_INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT_VERSION = '2.20250222.10.00';

// Detect serverless environment
const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  process.env.CF_WORKER
);

// Enhanced context with environment-aware settings
const INNERTUBE_CONTEXT = {
  client: {
    hl: 'en',
    gl: 'US',
    clientName: 'WEB',
    clientVersion: INNERTUBE_CLIENT_VERSION,
    osName: isServerless ? 'Linux' : 'Windows',
    osVersion: isServerless ? '6.5.0' : '10.0',
    platform: 'DESKTOP',
    clientFormFactor: 'UNKNOWN_FORM_FACTOR',
    userInterfaceTheme: 'USER_INTERFACE_THEME_LIGHT',
    timeZone: 'UTC',
    browserName: 'Chrome',
    browserVersion: '119.0.0.0',
    utcOffsetMinutes: 0,
    originalUrl: 'https://www.youtube.com',
    visitorData: 'CgtaZUtlV3E2WFpOOCiIjYyyBg%3D%3D',
    memoryTotalKbytes: '8000000',
    mainAppWebInfo: {
      graftUrl: 'https://www.youtube.com',
      pwaInstallabilityStatus: 'PWA_INSTALLABILITY_STATUS_UNKNOWN',
      webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER',
      isWebNativeShareAvailable: true,
    },
  },
  user: {
    enableSafetyMode: false,
    lockedSafetyMode: false,
  },
  request: {
    useSsl: true,
    internalExperimentFlags: [],
  },
};

// Cache for the dynamically fetched API key
let cachedApiKey: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Production-ready timeouts and retry settings
const TIMEOUTS = {
  API_KEY_FETCH: isServerless ? 8000 : 10000, // Shorter timeout for serverless
  PLAYER_REQUEST: isServerless ? 15000 : 20000,
  SUBTITLE_FETCH: isServerless ? 10000 : 15000,
};

const RETRY_CONFIG = {
  MAX_RETRIES: isServerless ? 2 : 3,
  INITIAL_DELAY: 1000,
  BACKOFF_FACTOR: 1.5,
};

function generateRandomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Enhanced fetch with timeout and error handling
async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 10000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

// Retry mechanism for critical operations
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries: number = RETRY_CONFIG.MAX_RETRIES
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt <= maxRetries) {
        const delay =
          RETRY_CONFIG.INITIAL_DELAY *
          Math.pow(RETRY_CONFIG.BACKOFF_FACTOR, attempt - 1);
        console.warn(
          `${context} failed (attempt ${attempt}/${maxRetries + 1}): ${
            lastError.message
          }. Retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `${context} failed after ${maxRetries + 1} attempts: ${lastError!.message}`
  );
}

async function getDynamicApiKey(): Promise<string> {
  try {
    // Check cache first
    const now = Date.now();
    if (cachedApiKey && now - cacheTimestamp < CACHE_DURATION) {
      console.log('Using cached dynamic API key');
      return cachedApiKey;
    }

    console.log(
      `Fetching dynamic API key from YouTube... (serverless: ${isServerless})`
    );

    const apiKey = await withRetry(async () => {
      // Generate visitor ID for tracking
      const visitorId = generateRandomString(11);

      // Enhanced headers for production compatibility
      const headers: Record<string, string> = {
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: '*/*',
        Referer: 'https://www.youtube.com/sw.js',
        Origin: 'https://www.youtube.com',
        DNT: '1',
        'Sec-GPC': '1',
        'Sec-Fetch-Dest': 'script',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-origin',
        Cookie: `PREF=tz=UTC;VISITOR_INFO1_LIVE=${visitorId};`,
      };

      // Environment-specific User-Agent
      if (isServerless) {
        headers['User-Agent'] =
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
      } else {
        headers['User-Agent'] =
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
      }

      // Fetch from YouTube's service worker data endpoint
      const response = await fetchWithTimeout(
        'https://www.youtube.com/sw.js_data',
        {
          headers,
          timeout: TIMEOUTS.API_KEY_FETCH,
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch dynamic API key: ${response.status} ${response.statusText}`
        );
      }

      const text = await response.text();

      // Parse JSPB response (starts with )]}')
      if (!text.startsWith(")]}'")) {
        throw new Error('Invalid JSPB response format');
      }

      const data = JSON.parse(text.replace(/^\)\]\}'/, ''));
      const ytcfg = data[0][2];

      // Extract API key from the configuration
      const [, apiKey] = ytcfg;

      if (!apiKey || typeof apiKey !== 'string') {
        throw new Error('API key not found in response');
      }

      return apiKey;
    }, 'Dynamic API key fetch');

    // Cache the key
    cachedApiKey = apiKey;
    cacheTimestamp = now;

    console.log('Successfully fetched dynamic API key');
    return apiKey;
  } catch (error) {
    console.warn(
      'Failed to fetch dynamic API key:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    throw error;
  }
}

async function getApiKey(): Promise<string> {
  try {
    // Try to get dynamic API key first
    return await getDynamicApiKey();
  } catch (error) {
    // Fall back to hardcoded key
    console.warn(
      `Falling back to hardcoded API key due to error (serverless: ${isServerless}):`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return FALLBACK_INNERTUBE_API_KEY;
  }
}

async function fetchVideoData(videoID: string) {
  return withRetry(async () => {
    // Get API key (dynamic with fallback)
    const apiKey = await getApiKey();

    // Enhanced headers for production compatibility
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
      DNT: '1',
      'Sec-GPC': '1',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    };

    // Environment-specific User-Agent
    if (isServerless) {
      headers['User-Agent'] =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
    } else {
      headers['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
    }

    // Use the more reliable InnerTube endpoint with proper context
    const playerResponse = await fetchWithTimeout(
      `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          context: INNERTUBE_CONTEXT,
          videoId: videoID,
          playbackContext: {
            contentPlaybackContext: {
              vis: 0,
              splay: false,
              lactMilliseconds: '-1',
            },
          },
          racyCheckOk: true,
          contentCheckOk: true,
        }),
        timeout: TIMEOUTS.PLAYER_REQUEST,
      }
    );

    if (!playerResponse.ok) {
      throw new Error(
        `Player endpoint failed: ${playerResponse.status} ${playerResponse.statusText}`
      );
    }

    const playerData = await playerResponse.json();

    // Check for errors in response
    if (playerData.playabilityStatus?.status === 'ERROR') {
      throw new Error(
        `Video not available: ${
          playerData.playabilityStatus.reason || 'Unknown error'
        }`
      );
    }

    return playerData;
  }, 'Video data fetch');
}

async function fetchCaptionTracks(videoID: string) {
  try {
    const playerData = await fetchVideoData(videoID);

    // Debug: Log the structure we're getting
    console.log(`[DEBUG] Serverless: ${isServerless}, VideoID: ${videoID}`);
    console.log(`[DEBUG] Player response keys:`, Object.keys(playerData || {}));
    console.log(`[DEBUG] Has captions key:`, !!playerData?.captions);

    if (playerData?.captions) {
      console.log(`[DEBUG] Captions keys:`, Object.keys(playerData.captions));
      console.log(
        `[DEBUG] Has playerCaptionsTracklistRenderer:`,
        !!playerData.captions.playerCaptionsTracklistRenderer
      );

      if (playerData.captions.playerCaptionsTracklistRenderer) {
        const renderer = playerData.captions.playerCaptionsTracklistRenderer;
        console.log(`[DEBUG] Renderer keys:`, Object.keys(renderer));
        console.log(`[DEBUG] Has captionTracks:`, !!renderer.captionTracks);
        console.log(
          `[DEBUG] CaptionTracks length:`,
          renderer.captionTracks?.length || 0
        );

        if (renderer.captionTracks?.length > 0) {
          console.log(
            `[DEBUG] First caption track:`,
            JSON.stringify(renderer.captionTracks[0], null, 2)
          );
        }
      }
    }

    // Extract caption tracks from player response
    const captionTracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ??
      [];

    console.log(`[DEBUG] Extracted ${captionTracks.length} caption tracks`);

    if (!captionTracks.length) {
      console.log(
        `[DEBUG] No standard caption tracks found, checking adaptive formats...`
      );

      // Debug adaptive formats
      const streamingData = playerData?.streamingData;
      console.log(`[DEBUG] Has streamingData:`, !!streamingData);

      if (streamingData) {
        console.log(`[DEBUG] StreamingData keys:`, Object.keys(streamingData));
        const adaptiveFormats = streamingData.adaptiveFormats || [];
        console.log(`[DEBUG] AdaptiveFormats length:`, adaptiveFormats.length);

        // Try alternative caption extraction from adaptive formats
        const captionFormats = adaptiveFormats.filter(
          (format: any) => format.mimeType && format.mimeType.includes('text/')
        );

        console.log(
          `[DEBUG] Found ${captionFormats.length} text formats in adaptive streams`
        );

        if (captionFormats.length > 0) {
          console.log(
            `[DEBUG] First text format:`,
            JSON.stringify(captionFormats[0], null, 2)
          );
          return captionFormats.map((format: any) => ({
            baseUrl: format.url,
            vssId: format.languageCode || 'unknown',
          }));
        }
      }

      // Final debug: Check if there are any other caption-related fields
      console.log(
        `[DEBUG] Searching for any caption-related fields in player response...`
      );
      const playerDataStr = JSON.stringify(playerData);
      const captionMatches = playerDataStr.match(/caption/gi);
      console.log(
        `[DEBUG] Found ${
          captionMatches?.length || 0
        } occurrences of 'caption' in response`
      );

      // Check for alternative caption fields
      if (playerData?.captions?.playerCaptionsRenderer) {
        console.log(
          `[DEBUG] Found playerCaptionsRenderer:`,
          JSON.stringify(playerData.captions.playerCaptionsRenderer, null, 2)
        );
      }

      // Check for subtitle fields
      const subtitleMatches = playerDataStr.match(/subtitle/gi);
      console.log(
        `[DEBUG] Found ${
          subtitleMatches?.length || 0
        } occurrences of 'subtitle' in response`
      );
    }

    return captionTracks;
  } catch (error) {
    console.error(`[DEBUG] Error in fetchCaptionTracks:`, error);
    throw error;
  }
}

function extractSubtitlesFromXML(
  transcript: string,
  startRegex: RegExp,
  durRegex: RegExp
): Subtitle[] {
  return transcript
    .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', '')
    .replace('</transcript>', '')
    .split('</text>')
    .filter((line: string) => line && line.trim())
    .reduce((acc: Subtitle[], line: string) => {
      // Extract start and duration times using regex patterns
      const startResult = startRegex.exec(line);
      const durResult = durRegex.exec(line);

      if (!startResult || !durResult) {
        console.warn(`Failed to extract start or duration from line: ${line}`);
        return acc;
      }

      const [, start] = startResult;
      const [, dur] = durResult;

      // Clean up subtitle text by removing HTML tags and decoding HTML entities
      const htmlText = line
        .replace(/<text.+>/, '')
        .replace(/&amp;/gi, '&')
        .replace(/<\/?[^>]+(>|$)/g, '');
      const decodedText = he.decode(htmlText);
      const text = striptags(decodedText);

      // Create a subtitle object with start, duration, and text properties
      acc.push({
        start,
        dur,
        text,
      });

      return acc;
    }, []);
}

export const getVideoDetails = async ({
  videoID,
  lang = 'en',
}: Options): Promise<VideoDetails> => {
  try {
    const playerData = await fetchVideoData(videoID);

    // Extract title and description from player data
    const videoDetails = playerData?.videoDetails;
    const title = videoDetails?.title || 'No title found';
    const description =
      videoDetails?.shortDescription || 'No description found';

    console.log(`[DEBUG] Video title: ${title}`);

    // Retrieve caption tracks
    const captionTracks = await fetchCaptionTracks(videoID);
    if (!captionTracks.length) {
      console.warn(
        `[DEBUG] No captions found for video: ${videoID} (language: ${lang})`
      );
      return { title, description, subtitles: [] };
    }

    console.log(
      `[DEBUG] Available caption tracks:`,
      captionTracks.map((track: CaptionTrack) => ({
        vssId: track.vssId,
        hasBaseUrl: !!track.baseUrl,
      }))
    );

    // Find the appropriate subtitle language track
    const subtitle =
      captionTracks.find((track: CaptionTrack) => track.vssId === `.${lang}`) ||
      captionTracks.find(
        (track: CaptionTrack) => track.vssId === `a.${lang}`
      ) ||
      captionTracks.find(
        (track: CaptionTrack) => track.vssId && track.vssId.match(`.${lang}`)
      );

    console.log(`[DEBUG] Looking for language: ${lang}`);
    console.log(
      `[DEBUG] Selected subtitle track:`,
      subtitle
        ? { vssId: subtitle.vssId, hasBaseUrl: !!subtitle.baseUrl }
        : 'none'
    );

    // Check if the subtitle language track exists
    if (!subtitle?.baseUrl) {
      console.warn(`[DEBUG] Could not find ${lang} captions for ${videoID}`);
      console.log(
        `[DEBUG] Available languages:`,
        captionTracks.map((track: CaptionTrack) => track.vssId).join(', ')
      );
      return {
        title,
        description,
        subtitles: [],
      };
    }

    // Fetch subtitles XML from the subtitle track URL with retry
    const lines = await withRetry(async () => {
      const subtitlesResponse = await fetchWithTimeout(
        subtitle.baseUrl.replace('&fmt=srv3', ''), // force XML not JSON3
        {
          timeout: TIMEOUTS.SUBTITLE_FETCH,
        }
      );

      if (!subtitlesResponse.ok) {
        throw new Error(
          `Failed to fetch subtitles: ${subtitlesResponse.status}`
        );
      }

      const transcript = await subtitlesResponse.text();
      console.log(
        `[DEBUG] Subtitle XML length: ${transcript.length} characters`
      );

      // Define regex patterns for extracting start and duration times
      const startRegex = /start="([\d.]+)"/;
      const durRegex = /dur="([\d.]+)"/;

      // Process the subtitles XML to create an array of subtitle objects
      return extractSubtitlesFromXML(transcript, startRegex, durRegex);
    }, 'Subtitle fetch');

    console.log(`[DEBUG] Extracted ${lines.length} subtitle lines`);

    return {
      title,
      description,
      subtitles: lines,
    };
  } catch (error) {
    console.error(`[DEBUG] Error in getVideoDetails:`, error);
    throw error;
  }
};

export const getSubtitles = async ({
  videoID,
  lang = 'en',
}: Options): Promise<Subtitle[]> => {
  try {
    // Directly obtain caption tracks (faster & future-proof)
    const captionTracks = await fetchCaptionTracks(videoID);
    if (!captionTracks.length) {
      console.warn(`No captions found for video: ${videoID}`);
      return [];
    }

    // Find the appropriate subtitle language track
    const subtitle =
      captionTracks.find((track: CaptionTrack) => track.vssId === `.${lang}`) ||
      captionTracks.find(
        (track: CaptionTrack) => track.vssId === `a.${lang}`
      ) ||
      captionTracks.find(
        (track: CaptionTrack) => track.vssId && track.vssId.match(`.${lang}`)
      );

    // Check if the subtitle language track exists
    if (!subtitle?.baseUrl) {
      console.warn(`Could not find ${lang} captions for ${videoID}`);
      return [];
    }

    // Fetch subtitles XML from the subtitle track URL with retry
    return await withRetry(async () => {
      const subtitlesResponse = await fetchWithTimeout(
        subtitle.baseUrl.replace('&fmt=srv3', ''),
        {
          timeout: TIMEOUTS.SUBTITLE_FETCH,
        }
      );

      if (!subtitlesResponse.ok) {
        throw new Error(
          `Failed to fetch subtitles: ${subtitlesResponse.status}`
        );
      }

      const transcript = await subtitlesResponse.text();

      // Define regex patterns for extracting start and duration times
      const startRegex = /start="([\d.]+)"/;
      const durRegex = /dur="([\d.]+)"/;

      // Process the subtitles XML to create an array of subtitle objects
      return extractSubtitlesFromXML(transcript, startRegex, durRegex);
    }, 'Subtitle fetch');
  } catch (error) {
    console.error('Error getting subtitles:', error);
    throw error;
  }
};

// Export the API key functions for advanced users
export { getApiKey, getDynamicApiKey };
