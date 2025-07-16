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

// Detect serverless environment
const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  process.env.CF_WORKER
);

// For serverless environments, use a completely different strategy
// that doesn't rely on InnerTube API which has bot detection
async function getVideoDataServerless(videoID: string) {
  console.log(`[DEBUG] Using serverless strategy for video ${videoID}`);

  try {
    // Strategy 1: Try to get data from YouTube's oEmbed API (no bot detection)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoID}&format=json`;

    const oembedResponse = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VideoBot/1.0)',
      },
    });

    if (oembedResponse.ok) {
      const oembedData = await oembedResponse.json();
      console.log(`[DEBUG] Got oEmbed data:`, oembedData);

      // Now try to get subtitle data from a different approach
      const subtitles = await getSubtitlesViaTranscriptAPI(videoID);

      return {
        videoDetails: {
          title: oembedData.title || 'Unknown title',
          shortDescription: 'Description from oEmbed',
        },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: subtitles,
          },
        },
      };
    }
  } catch (error) {
    console.warn(
      `[DEBUG] oEmbed strategy failed:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }

  // Strategy 2: Try to extract from watch page HTML (more reliable for serverless)
  try {
    console.log(`[DEBUG] Trying watch page extraction for ${videoID}`);
    return await extractFromWatchPage(videoID);
  } catch (error) {
    console.warn(
      `[DEBUG] Watch page strategy failed:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }

  throw new Error('All serverless strategies failed');
}

// Extract video data directly from the watch page HTML
async function extractFromWatchPage(videoID: string) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoID}`;

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
  };

  const response = await fetch(watchUrl, { headers });

  if (!response.ok) {
    throw new Error(`Watch page request failed: ${response.status}`);
  }

  const html = await response.text();

  // Extract ytInitialPlayerResponse from the page
  const playerResponseMatch = html.match(
    /var ytInitialPlayerResponse = ({.+?});/
  );
  if (!playerResponseMatch) {
    throw new Error('Could not find ytInitialPlayerResponse in watch page');
  }

  try {
    const playerData = JSON.parse(playerResponseMatch[1]);
    console.log(
      `[DEBUG] Extracted player data from watch page:`,
      Object.keys(playerData)
    );
    return playerData;
  } catch (parseError) {
    throw new Error('Failed to parse ytInitialPlayerResponse');
  }
}

// Try to get subtitles using YouTube's transcript API
async function getSubtitlesViaTranscriptAPI(
  videoID: string
): Promise<CaptionTrack[]> {
  try {
    // This is a more direct approach to get transcript data
    // YouTube exposes transcript info through a different endpoint
    const timedTextUrl = `https://www.youtube.com/api/timedtext?v=${videoID}&type=list`;

    const response = await fetch(timedTextUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: `https://www.youtube.com/watch?v=${videoID}`,
      },
    });

    if (!response.ok) {
      console.warn(`[DEBUG] Timed text API failed: ${response.status}`);
      return [];
    }

    const xmlText = await response.text();
    console.log(`[DEBUG] Got timed text response:`, xmlText.substring(0, 200));

    // Parse the XML to extract available languages
    const tracks: CaptionTrack[] = [];
    const trackMatches = xmlText.matchAll(/<track[^>]+>/g);

    for (const match of trackMatches) {
      const trackXml = match[0];
      const langCodeMatch = trackXml.match(/lang_code="([^"]+)"/);
      const nameMatch = trackXml.match(/name="([^"]+)"/);

      if (langCodeMatch) {
        const langCode = langCodeMatch[1];
        tracks.push({
          baseUrl: `https://www.youtube.com/api/timedtext?v=${videoID}&lang=${langCode}`,
          vssId: `.${langCode}`,
        });
      }
    }

    console.log(
      `[DEBUG] Found ${tracks.length} caption tracks via transcript API`
    );
    return tracks;
  } catch (error) {
    console.warn(
      `[DEBUG] Transcript API failed:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return [];
  }
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
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt <= maxRetries) {
        const delay = 1000 * attempt; // Simple linear backoff
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

// Main function to get video data - uses different strategies based on environment
async function fetchVideoData(videoID: string) {
  if (isServerless) {
    // For serverless environments, use alternative strategies that don't trigger bot detection
    console.log(`[DEBUG] Using serverless environment strategy`);
    return await getVideoDataServerless(videoID);
  }

  // For local development, fall back to the original approach
  console.log(`[DEBUG] Using local development strategy`);
  return await getVideoDataLocal(videoID);
}

// Original approach for local development
async function getVideoDataLocal(videoID: string) {
  const apiKey = FALLBACK_INNERTUBE_API_KEY;

  const context = {
    client: {
      hl: 'en',
      gl: 'US',
      clientName: 'WEB',
      clientVersion: '2.20250222.10.00',
    },
    user: {
      enableSafetyMode: false,
    },
    request: {
      useSsl: true,
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  const response = await fetchWithTimeout(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
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
      }),
      timeout: 15000,
    }
  );

  if (!response.ok) {
    throw new Error(
      `Player endpoint failed: ${response.status} ${response.statusText}`
    );
  }

  const playerData = await response.json();
  console.log(
    `[DEBUG] Local strategy response keys:`,
    Object.keys(playerData || {})
  );
  return playerData;
}

async function fetchCaptionTracks(videoID: string) {
  try {
    const playerData = await fetchVideoData(videoID);

    console.log(`[DEBUG] Serverless: ${isServerless}, VideoID: ${videoID}`);
    console.log(`[DEBUG] Player response keys:`, Object.keys(playerData || {}));
    console.log(`[DEBUG] Has captions key:`, !!playerData?.captions);

    // Extract caption tracks from player response
    const captionTracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ??
      [];

    console.log(`[DEBUG] Extracted ${captionTracks.length} caption tracks`);

    if (!captionTracks.length) {
      console.log(`[DEBUG] No caption tracks found in player response`);
      return [];
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
          timeout: 10000,
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
    // Directly obtain caption tracks
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
          timeout: 10000,
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
