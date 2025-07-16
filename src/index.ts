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

interface Options {
  videoID: string;
  lang?: string;
}

export interface VideoDetails {
  title: string;
  description: string;
  subtitles: Subtitle[];
}

// YouTube InnerTube API configuration based on YouTube.js
const INNERTUBE_CONFIG = {
  API_BASE: 'https://www.youtube.com/youtubei/v1',
  API_KEY: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  CLIENT: {
    WEB: {
      NAME: 'WEB',
      VERSION: '2.20250222.10.00',
    },
    ANDROID: {
      NAME: 'ANDROID',
      VERSION: '19.35.36',
    },
  },
};

// Detect serverless environment
const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  process.env.CF_WORKER
);

// Generate proper session data for serverless environments
function generateSessionData() {
  const visitorData = generateVisitorData();

  return {
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: INNERTUBE_CONFIG.CLIENT.WEB.NAME,
        clientVersion: INNERTUBE_CONFIG.CLIENT.WEB.VERSION,
        visitorData,
      },
      user: {
        enableSafetyMode: false,
      },
      request: {
        useSsl: true,
      },
    },
    visitorData,
  };
}

// Generate visitor data (simplified version of YouTube.js approach)
function generateVisitorData(): string {
  // This is a simplified version - YouTube.js uses more complex protobuf encoding
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < 11; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Enhanced fetch with proper InnerTube headers
async function fetchInnerTube(endpoint: string, data: any): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'X-Youtube-Client-Version': INNERTUBE_CONFIG.CLIENT.WEB.VERSION,
    'X-Youtube-Client-Name': '1', // WEB client ID
    'X-Goog-Visitor-Id': data.visitorData,
    Origin: 'https://www.youtube.com',
    Referer: 'https://www.youtube.com/',
  };

  const url = `${INNERTUBE_CONFIG.API_BASE}${endpoint}?key=${INNERTUBE_CONFIG.API_KEY}`;

  console.log(`[DEBUG] Calling InnerTube endpoint: ${endpoint}`);

  return await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
}

// Get video info using proper InnerTube API
async function getVideoInfo(videoID: string) {
  const sessionData = generateSessionData();

  const payload = {
    ...sessionData,
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

  const response = await fetchInnerTube('/player', payload);

  if (!response.ok) {
    throw new Error(
      `Player API failed: ${response.status} ${response.statusText}`
    );
  }

  const playerData = await response.json();

  if (playerData.playabilityStatus?.status === 'LOGIN_REQUIRED') {
    console.log(`[DEBUG] LOGIN_REQUIRED status, trying next endpoint`);

    // Try the next endpoint for additional data including engagement panels
    const nextPayload = {
      ...sessionData,
      videoId: videoID,
    };

    const nextResponse = await fetchInnerTube('/next', nextPayload);

    if (!nextResponse.ok) {
      throw new Error(
        `Next API failed: ${nextResponse.status} ${nextResponse.statusText}`
      );
    }

    const nextData = await nextResponse.json();
    console.log(`[DEBUG] Next API response keys:`, Object.keys(nextData));

    return { playerData, nextData };
  }

  console.log(
    `[DEBUG] Player API success, status:`,
    playerData.playabilityStatus?.status
  );
  return { playerData, nextData: null };
}

// Extract transcript using proper engagement panel approach (like YouTube.js)
async function getTranscriptFromEngagementPanel(
  videoID: string,
  nextData: any
): Promise<Subtitle[]> {
  if (!nextData?.engagementPanels) {
    console.log(`[DEBUG] No engagement panels found`);
    return [];
  }

  console.log(
    `[DEBUG] Found ${nextData.engagementPanels.length} engagement panels`
  );

  // Find the transcript panel
  const transcriptPanel = nextData.engagementPanels.find(
    (panel: any) =>
      panel?.engagementPanelSectionListRenderer?.panelIdentifier ===
      'engagement-panel-searchable-transcript'
  );

  if (!transcriptPanel) {
    console.log(`[DEBUG] No transcript engagement panel found`);
    return [];
  }

  console.log(`[DEBUG] Found transcript engagement panel`);

  // Extract continuation token for transcript
  const content = transcriptPanel.engagementPanelSectionListRenderer?.content;

  // Debug the transcript panel structure
  console.log(
    `[DEBUG] Transcript panel content keys:`,
    Object.keys(content || {})
  );
  if (content?.sectionListRenderer) {
    console.log(
      `[DEBUG] SectionListRenderer contents length:`,
      content.sectionListRenderer.contents?.length
    );
    if (content.sectionListRenderer.contents?.[0]) {
      console.log(
        `[DEBUG] First content keys:`,
        Object.keys(content.sectionListRenderer.contents[0])
      );
    }
  }

  // Try multiple ways to find the continuation token
  let continuationItem;
  let token;

  // Method 1: Direct continuationItemRenderer
  continuationItem = content?.continuationItemRenderer;
  console.log(
    `[DEBUG] ContinuationItem keys:`,
    Object.keys(continuationItem || {})
  );

  if (continuationItem) {
    // Log the full structure to understand what's available
    console.log(
      `[DEBUG] ContinuationItem structure:`,
      JSON.stringify(continuationItem, null, 2)
    );
  }

  // Check for different token/params structures
  if (continuationItem?.continuationEndpoint?.continuationCommand?.token) {
    token = continuationItem.continuationEndpoint.continuationCommand.token;
    console.log(
      `[DEBUG] Found token via Method 1 (continuationCommand):`,
      token.substring(0, 50) + '...'
    );
  } else if (
    continuationItem?.continuationEndpoint?.getTranscriptEndpoint?.params
  ) {
    token = continuationItem.continuationEndpoint.getTranscriptEndpoint.params;
    console.log(
      `[DEBUG] Found token via Method 1 (getTranscriptEndpoint):`,
      token.substring(0, 50) + '...'
    );
  }

  // Method 2: Inside sectionListRenderer
  if (!token && content?.sectionListRenderer?.contents?.[0]) {
    continuationItem =
      content.sectionListRenderer.contents[0].continuationItemRenderer;
    if (continuationItem?.continuationEndpoint?.continuationCommand?.token) {
      token = continuationItem.continuationEndpoint.continuationCommand.token;
    }
  }

  // Method 3: Look for transcriptRenderer with footer
  if (!token && content?.sectionListRenderer?.contents) {
    for (const item of content.sectionListRenderer.contents) {
      if (item?.transcriptRenderer) {
        // Look for footer with continuation
        const footer = item.transcriptRenderer.footer;
        if (
          footer?.transcriptFooterRenderer?.languageMenu
            ?.sortFilterSubMenuRenderer?.subMenuItems
        ) {
          // Find English or first available language
          const menuItems =
            footer.transcriptFooterRenderer.languageMenu
              .sortFilterSubMenuRenderer.subMenuItems;
          const englishItem =
            menuItems.find(
              (item: any) =>
                item?.title?.toLowerCase().includes('english') ||
                item?.selected === true
            ) || menuItems[0];

          if (englishItem?.continuation?.reloadContinuationData?.continuation) {
            token =
              englishItem.continuation.reloadContinuationData.continuation;
            break;
          }
        }
      }
    }
  }

  if (!token) {
    console.log(`[DEBUG] No continuation token found in transcript panel`);
    return [];
  }
  console.log(`[DEBUG] Found continuation token, calling get_transcript`);

  // Call the get_transcript endpoint
  const sessionData = generateSessionData();
  const transcriptPayload = {
    ...sessionData,
    params: token,
  };

  const transcriptResponse = await fetchInnerTube(
    '/get_transcript',
    transcriptPayload
  );

  if (!transcriptResponse.ok) {
    throw new Error(
      `Transcript API failed: ${transcriptResponse.status} ${transcriptResponse.statusText}`
    );
  }

  const transcriptData = await transcriptResponse.json();
  console.log(
    `[DEBUG] Transcript API response keys:`,
    Object.keys(transcriptData)
  );

  // Parse transcript segments
  const segments =
    transcriptData?.actions?.[0]?.updateEngagementPanelAction?.content
      ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
      ?.transcriptSegmentListRenderer?.initialSegments;

  if (!segments || !Array.isArray(segments)) {
    console.log(`[DEBUG] No transcript segments found`);
    return [];
  }

  console.log(`[DEBUG] Found ${segments.length} transcript segments`);

  // Debug the first few segments to understand the structure
  if (segments.length > 0) {
    console.log(`[DEBUG] First segment keys:`, Object.keys(segments[0]));
    console.log(
      `[DEBUG] First segment structure:`,
      JSON.stringify(segments[0], null, 2)
    );

    if (segments.length > 1) {
      console.log(`[DEBUG] Second segment keys:`, Object.keys(segments[1]));
    }
  }

  const subtitles: Subtitle[] = [];
  let debugCount = 0;

  for (const segment of segments) {
    if (segment.transcriptSegmentRenderer) {
      const renderer = segment.transcriptSegmentRenderer;

      // Only debug first 3 segments to avoid excessive logging
      if (debugCount < 3) {
        console.log(`[DEBUG] Segment renderer keys:`, Object.keys(renderer));

        // Debug snippet structure
        if (renderer.snippet) {
          console.log(`[DEBUG] Snippet keys:`, Object.keys(renderer.snippet));
          console.log(
            `[DEBUG] Snippet structure:`,
            JSON.stringify(renderer.snippet, null, 2)
          );
        }
        debugCount++;
      }

      const startMs = parseInt(renderer.startMs || '0');
      const endMs = parseInt(renderer.endMs || '0');

      // Try different text extraction paths
      let text = '';
      if (renderer.snippet?.simpleText) {
        text = renderer.snippet.simpleText;
      } else if (renderer.snippet?.runs) {
        text = renderer.snippet.runs.map((run: any) => run.text).join('');
      } else if (renderer.snippet?.text) {
        text = renderer.snippet.text;
      }

      console.log(
        `[DEBUG] Segment: startMs=${startMs}, endMs=${endMs}, text="${text}"`
      );

      if (text.trim()) {
        subtitles.push({
          start: (startMs / 1000).toString(),
          dur: ((endMs - startMs) / 1000).toString(),
          text: he.decode(striptags(text)),
        });
      }
    } else {
      console.log(
        `[DEBUG] Segment without transcriptSegmentRenderer:`,
        Object.keys(segment)
      );
    }
  }

  return subtitles;
}

// Fallback: Extract captions from player data (traditional method)
async function getSubtitlesFromCaptions(
  videoID: string,
  playerData: any,
  lang: string = 'en'
): Promise<Subtitle[]> {
  const captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || !Array.isArray(captionTracks)) {
    console.log(`[DEBUG] No caption tracks found in player data`);
    return [];
  }

  console.log(`[DEBUG] Found ${captionTracks.length} caption tracks`);

  // Find the appropriate subtitle language track
  const subtitle =
    captionTracks.find((track: any) => track.vssId === `.${lang}`) ||
    captionTracks.find((track: any) => track.vssId === `a.${lang}`) ||
    captionTracks.find((track: any) => track.vssId?.includes(`.${lang}`)) ||
    captionTracks[0]; // fallback to first available

  if (!subtitle?.baseUrl) {
    console.log(`[DEBUG] No suitable caption track found`);
    return [];
  }

  console.log(`[DEBUG] Using caption track: ${subtitle.vssId}`);

  // Fetch the caption content
  const captionUrl = subtitle.baseUrl.replace('&fmt=srv3', ''); // Force XML format

  const response = await fetch(captionUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: `https://www.youtube.com/watch?v=${videoID}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Caption fetch failed: ${response.status}`);
  }

  const xmlText = await response.text();

  if (!xmlText.trim() || !xmlText.includes('<text')) {
    throw new Error('Caption content is empty or invalid');
  }

  console.log(`[DEBUG] Caption XML length: ${xmlText.length} characters`);

  // Parse XML captions
  const startRegex = /start="([\d.]+)"/;
  const durRegex = /dur="([\d.]+)"/;

  return extractSubtitlesFromXML(xmlText, startRegex, durRegex);
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
      const startResult = startRegex.exec(line);
      const durResult = durRegex.exec(line);

      if (!startResult || !durResult) {
        return acc;
      }

      const [, start] = startResult;
      const [, dur] = durResult;

      const htmlText = line
        .replace(/<text.+>/, '')
        .replace(/&amp;/gi, '&')
        .replace(/<\/?[^>]+(>|$)/g, '');
      const decodedText = he.decode(htmlText);
      const text = striptags(decodedText);

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
    console.log(
      `[DEBUG] Getting video details for ${videoID}, serverless: ${isServerless}`
    );

    // Get video info using proper InnerTube API
    const { playerData, nextData } = await getVideoInfo(videoID);

    // Extract basic video details
    const videoDetails = playerData?.videoDetails;
    const title = videoDetails?.title || 'No title found';
    const description =
      videoDetails?.shortDescription || 'No description found';

    console.log(`[DEBUG] Video title: ${title}`);

    let subtitles: Subtitle[] = [];

    // Method 1: Try to get transcript from engagement panel (preferred, like YouTube.js)
    if (nextData) {
      try {
        subtitles = await getTranscriptFromEngagementPanel(videoID, nextData);
        if (subtitles.length > 0) {
          console.log(
            `[DEBUG] Successfully got ${subtitles.length} subtitles from transcript API`
          );
        }
      } catch (error) {
        console.warn(
          `[DEBUG] Transcript API failed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    // Method 2: Fallback to traditional caption tracks
    if (subtitles.length === 0) {
      try {
        subtitles = await getSubtitlesFromCaptions(videoID, playerData, lang);
        if (subtitles.length > 0) {
          console.log(
            `[DEBUG] Successfully got ${subtitles.length} subtitles from captions`
          );
        }
      } catch (error) {
        console.warn(
          `[DEBUG] Caption fallback failed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    if (subtitles.length === 0) {
      console.warn(
        `[DEBUG] No subtitles found for video: ${videoID} (language: ${lang})`
      );
    }

    return {
      title,
      description,
      subtitles,
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
    console.log(
      `[DEBUG] Getting subtitles for ${videoID}, serverless: ${isServerless}`
    );

    const { playerData, nextData } = await getVideoInfo(videoID);

    // Try transcript API first
    if (nextData) {
      try {
        const subtitles = await getTranscriptFromEngagementPanel(
          videoID,
          nextData
        );
        if (subtitles.length > 0) {
          return subtitles;
        }
      } catch (error) {
        console.warn(
          `[DEBUG] Transcript API failed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    // Fallback to captions
    return await getSubtitlesFromCaptions(videoID, playerData, lang);
  } catch (error) {
    console.error('Error getting subtitles:', error);
    throw error;
  }
};
