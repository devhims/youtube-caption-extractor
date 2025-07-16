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

// YouTube public API key (updated to match YouTube.js)
const FALLBACK_INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT_VERSION = '2.20250222.10.00';

// Detect serverless environment
const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  process.env.CF_WORKER
);

// Generate proper visitor data like YouTube.js does
function generateVisitorData(): string {
  const id = generateRandomString(11);
  const timestamp = Math.floor(Date.now() / 1000);

  // Simple base64 encoding of visitor data (simplified version of YouTube.js protobuf encoding)
  const data = JSON.stringify({ id, timestamp });
  const encoded = btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return encodeURIComponent(encoded);
}

// Client configurations updated to match YouTube.js latest versions
const CLIENT_CONFIGS = {
  WEB: {
    clientName: 'WEB',
    clientVersion: '2.20250222.10.00', // Updated to match YouTube.js
    clientNameId: '1',
    osName: isServerless ? 'Linux' : 'Windows',
    osVersion: isServerless ? '6.5.0' : '10.0',
    platform: 'DESKTOP',
    browserName: 'Chrome',
    browserVersion: '125.0.0.0', // Updated to match YouTube.js
    userAgent: isServerless
      ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  },
  ANDROID: {
    clientName: 'ANDROID',
    clientVersion: '19.35.36', // Updated to match YouTube.js
    clientNameId: '3',
    osName: 'Android',
    osVersion: '13', // Updated
    platform: 'MOBILE',
    androidSdkVersion: 33, // Added
    browserName: undefined,
    browserVersion: undefined,
    userAgent:
      'com.google.android.youtube/19.35.36(Linux; U; Android 13; en_US; SM-S908E Build/TP1A.220624.014) gzip',
  },
  IOS: {
    clientName: 'iOS',
    clientVersion: '20.11.6',
    clientNameId: '5',
    osName: 'iOS',
    osVersion: '16.7.7.20H330',
    platform: 'MOBILE',
    browserName: undefined,
    browserVersion: undefined,
    userAgent:
      'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)',
  },
};

// Create context for specific client with improved visitor data
function createClientContext(clientType: keyof typeof CLIENT_CONFIGS) {
  const config = CLIENT_CONFIGS[clientType];
  const visitorData = generateVisitorData();

  return {
    client: {
      hl: 'en',
      gl: 'US',
      clientName: config.clientName,
      clientVersion: config.clientVersion,
      osName: config.osName,
      osVersion: config.osVersion,
      platform: config.platform,
      clientFormFactor:
        clientType === 'WEB' ? 'UNKNOWN_FORM_FACTOR' : 'SMALL_FORM_FACTOR',
      userInterfaceTheme: 'USER_INTERFACE_THEME_LIGHT',
      timeZone: 'UTC',
      browserName: config.browserName,
      browserVersion: config.browserVersion,
      utcOffsetMinutes: 0,
      originalUrl: 'https://www.youtube.com',
      visitorData: visitorData,
      memoryTotalKbytes: '8000000',
      mainAppWebInfo:
        clientType === 'WEB'
          ? {
              graftUrl: 'https://www.youtube.com',
              pwaInstallabilityStatus: 'PWA_INSTALLABILITY_STATUS_UNKNOWN',
              webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER',
              isWebNativeShareAvailable: true,
            }
          : undefined,
      androidSdkVersion:
        clientType === 'ANDROID'
          ? (config as any).androidSdkVersion
          : undefined,
      deviceMake:
        clientType === 'ANDROID'
          ? 'Google'
          : clientType === 'IOS'
          ? 'Apple'
          : undefined,
      deviceModel:
        clientType === 'ANDROID'
          ? 'SM-S908E' // Updated to match YouTube.js
          : clientType === 'IOS'
          ? 'iPhone10,4'
          : undefined,
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
}

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
      };

      // Environment-specific User-Agent
      headers['User-Agent'] = CLIENT_CONFIGS.WEB.userAgent;

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

// Check if response has sufficient data
function isValidPlayerResponse(playerData: any): boolean {
  // Must have either captions or videoDetails or streamingData
  return !!(
    playerData?.captions ||
    playerData?.videoDetails ||
    playerData?.streamingData
  );
}

async function fetchVideoDataWithClient(
  videoID: string,
  clientType: keyof typeof CLIENT_CONFIGS
) {
  const apiKey = await getApiKey();
  const context = createClientContext(clientType);
  const config = CLIENT_CONFIGS[clientType];

  console.log(`[DEBUG] Trying ${clientType} client for video ${videoID}`);

  // Enhanced headers matching YouTube.js implementation
  const headers: Record<string, string> = {
    Accept: '*/*',
    'Accept-Language': '*',
    'User-Agent': config.userAgent,
    'X-Goog-Visitor-Id': context.client.visitorData || '',
    'X-Youtube-Client-Version': config.clientVersion,
  };

  // Add client name ID header like YouTube.js does
  if (config.clientNameId) {
    headers['X-Youtube-Client-Name'] = config.clientNameId;
  }

  // Add web-specific headers
  if (clientType === 'WEB') {
    headers['Content-Type'] = 'application/json';
    headers['Origin'] = 'https://www.youtube.com';
    headers['Referer'] = 'https://www.youtube.com/';
    headers['DNT'] = '1';
    headers['Sec-GPC'] = '1';
    headers['Sec-Fetch-Dest'] = 'empty';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Site'] = 'same-origin';
  } else {
    headers['Content-Type'] = 'application/json';
  }

  // Prepare request body with additional params for better compatibility
  const requestBody = {
    context,
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
  };

  // Add client-specific parameters
  if (clientType === 'ANDROID') {
    // Android clients may need additional params
    (requestBody as any).params = 'CgIQBg%3D%3D'; // Base64 encoded params that Android uses
  }

  // Use the more reliable InnerTube endpoint with proper context
  const playerResponse = await fetchWithTimeout(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      timeout: TIMEOUTS.PLAYER_REQUEST,
    }
  );

  if (!playerResponse.ok) {
    throw new Error(
      `Player endpoint failed with ${clientType}: ${playerResponse.status} ${playerResponse.statusText}`
    );
  }

  const playerData = await playerResponse.json();

  // Check for errors in response
  if (playerData.playabilityStatus?.status === 'ERROR') {
    throw new Error(
      `Video not available with ${clientType}: ${
        playerData.playabilityStatus.reason || 'Unknown error'
      }`
    );
  }

  console.log(
    `[DEBUG] ${clientType} response keys:`,
    Object.keys(playerData || {})
  );
  console.log(`[DEBUG] ${clientType} has captions:`, !!playerData?.captions);
  console.log(
    `[DEBUG] ${clientType} has videoDetails:`,
    !!playerData?.videoDetails
  );
  console.log(
    `[DEBUG] ${clientType} has streamingData:`,
    !!playerData?.streamingData
  );

  return { playerData, clientType };
}

async function fetchVideoData(videoID: string) {
  return withRetry(async () => {
    // Try clients in order: WEB, ANDROID, iOS (prioritize web for serverless)
    const clientTypes: (keyof typeof CLIENT_CONFIGS)[] = isServerless
      ? ['WEB', 'ANDROID', 'IOS']
      : ['ANDROID', 'WEB', 'IOS']; // Android often works better for non-serverless

    let lastValidResponse: any = null;

    for (const clientType of clientTypes) {
      try {
        const { playerData, clientType: usedClient } =
          await fetchVideoDataWithClient(videoID, clientType);

        // Store any response that has some data, even if not complete
        if (playerData && Object.keys(playerData).length > 5) {
          lastValidResponse = playerData;
        }

        if (isValidPlayerResponse(playerData)) {
          console.log(
            `[DEBUG] Successfully got valid response from ${usedClient} client`
          );
          return playerData;
        } else {
          console.warn(
            `[DEBUG] ${usedClient} client returned insufficient data, trying next client...`
          );

          // Debug: log the playability status if available
          if (playerData?.playabilityStatus) {
            console.log(
              `[DEBUG] ${usedClient} playability status:`,
              playerData.playabilityStatus.status
            );
            if (playerData.playabilityStatus.reason) {
              console.log(
                `[DEBUG] ${usedClient} reason:`,
                playerData.playabilityStatus.reason
              );
            }
          }
        }
      } catch (error) {
        console.warn(
          `[DEBUG] ${clientType} client failed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        // Continue to next client
      }
    }

    // If we have any response, return it as a last resort
    if (lastValidResponse) {
      console.warn(`[DEBUG] Returning last valid response as fallback`);
      return lastValidResponse;
    }

    // If all clients fail, throw error
    throw new Error(
      `All clients (${clientTypes.join(', ')}) failed to retrieve video data`
    );
  }, 'Video data fetch with multi-client fallback');
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
