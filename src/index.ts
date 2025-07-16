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
const INNERTUBE_CONTEXT = {
  client: {
    hl: 'en',
    gl: 'US',
    clientName: 'WEB',
    clientVersion: INNERTUBE_CLIENT_VERSION,
    osName: 'Windows',
    osVersion: '10.0',
    platform: 'DESKTOP',
    clientFormFactor: 'UNKNOWN_FORM_FACTOR',
    userInterfaceTheme: 'USER_INTERFACE_THEME_LIGHT',
    timeZone: 'UTC',
    browserName: 'Chrome',
    browserVersion: '119.0.0.0',
    utcOffsetMinutes: 0,
    originalUrl: 'https://www.youtube.com',
    visitorData: 'CgtaZUtlV3E2WFpOOCiIjYyyBg%3D%3D',
  },
  user: {
    enableSafetyMode: false,
    lockedSafetyMode: false,
  },
};

// Cache for the dynamically fetched API key
let cachedApiKey: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

function generateRandomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getDynamicApiKey(): Promise<string> {
  try {
    // Check cache first
    const now = Date.now();
    if (cachedApiKey && now - cacheTimestamp < CACHE_DURATION) {
      console.log('Using cached dynamic API key');
      return cachedApiKey;
    }

    console.log('Fetching dynamic API key from YouTube...');

    // Generate visitor ID for tracking
    const visitorId = generateRandomString(11);

    // Fetch from YouTube's service worker data endpoint (same as YouTube.js)
    const response = await fetch('https://www.youtube.com/sw.js_data', {
      headers: {
        'Accept-Language': 'en-US',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        Accept: '*/*',
        Referer: 'https://www.youtube.com/sw.js',
        Cookie: `PREF=tz=UTC;VISITOR_INFO1_LIVE=${visitorId};`,
      },
    });

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
      'Falling back to hardcoded API key due to error:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return FALLBACK_INNERTUBE_API_KEY;
  }
}

async function fetchVideoData(videoID: string) {
  try {
    // Get API key (dynamic with fallback)
    const apiKey = await getApiKey();

    // Use the more reliable InnerTube endpoint with proper context
    const playerResponse = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        },
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
  } catch (error) {
    console.error('Error fetching video data:', error);
    throw error;
  }
}

async function fetchCaptionTracks(videoID: string) {
  try {
    const playerData = await fetchVideoData(videoID);

    // Extract caption tracks from player response
    const captionTracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ??
      [];

    if (!captionTracks.length) {
      // Try alternative caption extraction from adaptive formats
      const adaptiveFormats = playerData?.streamingData?.adaptiveFormats ?? [];
      const captionFormats = adaptiveFormats.filter(
        (format: any) => format.mimeType && format.mimeType.includes('text/')
      );

      if (captionFormats.length > 0) {
        return captionFormats.map((format: any) => ({
          baseUrl: format.url,
          vssId: format.languageCode || 'unknown',
        }));
      }
    }

    return captionTracks;
  } catch (error) {
    console.error('Error fetching caption tracks:', error);
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

    // Retrieve caption tracks
    const captionTracks = await fetchCaptionTracks(videoID);
    if (!captionTracks.length) {
      console.warn(`No captions found for video: ${videoID}`);
      return { title, description, subtitles: [] };
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
      return {
        title,
        description,
        subtitles: [],
      };
    }

    // Fetch subtitles XML from the subtitle track URL
    const subtitlesResponse = await fetch(
      subtitle.baseUrl.replace('&fmt=srv3', '') // force XML not JSON3
    );

    if (!subtitlesResponse.ok) {
      throw new Error(`Failed to fetch subtitles: ${subtitlesResponse.status}`);
    }

    const transcript = await subtitlesResponse.text();

    // Define regex patterns for extracting start and duration times
    const startRegex = /start="([\d.]+)"/;
    const durRegex = /dur="([\d.]+)"/;

    // Process the subtitles XML to create an array of subtitle objects
    const lines = extractSubtitlesFromXML(transcript, startRegex, durRegex);

    return {
      title,
      description,
      subtitles: lines,
    };
  } catch (error) {
    console.error('Error getting video details:', error);
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

    // Fetch subtitles XML from the subtitle track URL
    const subtitlesResponse = await fetch(
      subtitle.baseUrl.replace('&fmt=srv3', '')
    );

    if (!subtitlesResponse.ok) {
      throw new Error(`Failed to fetch subtitles: ${subtitlesResponse.status}`);
    }

    const transcript = await subtitlesResponse.text();

    // Define regex patterns for extracting start and duration times
    const startRegex = /start="([\d.]+)"/;
    const durRegex = /dur="([\d.]+)"/;

    // Process the subtitles XML to create an array of subtitle objects
    return extractSubtitlesFromXML(transcript, startRegex, durRegex);
  } catch (error) {
    console.error('Error getting subtitles:', error);
    throw error;
  }
};

// Export the API key functions for advanced users
export { getApiKey, getDynamicApiKey };
