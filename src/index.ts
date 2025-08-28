import he from 'he';
import striptags from 'striptags';

// Universal logger that works in all environments (Node.js, Cloudflare Workers, etc.)
const createLogger = (namespace: string) => {
  const isDebugEnabled = () => {
    try {
      // Try to access environment variables in a safe way
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

      // Use console.log safely - available in all environments
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

  debug(`Calling InnerTube endpoint: ${endpoint}`);

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
    debug(` LOGIN_REQUIRED status, trying next endpoint`);

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
    debug(` Next API response keys:`, Object.keys(nextData));

    return { playerData, nextData };
  }

  debug(`Player API success, status:`, playerData.playabilityStatus?.status);
  return { playerData, nextData: null };
}

// Extract transcript using proper engagement panel approach (like YouTube.js)
async function getTranscriptFromEngagementPanel(
  videoID: string,
  nextData: any
): Promise<Subtitle[]> {
  if (!nextData?.engagementPanels) {
    debug(` No engagement panels found`);
    return [];
  }

  debug(` Found ${nextData.engagementPanels.length} engagement panels`);

  // Find the transcript panel
  const transcriptPanel = nextData.engagementPanels.find(
    (panel: any) =>
      panel?.engagementPanelSectionListRenderer?.panelIdentifier ===
      'engagement-panel-searchable-transcript'
  );

  if (!transcriptPanel) {
    debug(` No transcript engagement panel found`);
    return [];
  }

  debug(` Found transcript engagement panel`);

  // Extract continuation token for transcript
  const content = transcriptPanel.engagementPanelSectionListRenderer?.content;

  // Extract continuation token for transcript API

  // Try multiple ways to find the continuation token
  let continuationItem;
  let token;

  // Method 1: Direct continuationItemRenderer
  continuationItem = content?.continuationItemRenderer;

  // Check for different token/params structures
  if (continuationItem?.continuationEndpoint?.continuationCommand?.token) {
    token = continuationItem.continuationEndpoint.continuationCommand.token;
    debug(` Found token via continuationCommand`);
  } else if (
    continuationItem?.continuationEndpoint?.getTranscriptEndpoint?.params
  ) {
    token = continuationItem.continuationEndpoint.getTranscriptEndpoint.params;
    debug(` Found token via getTranscriptEndpoint`);
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
    debug(` No continuation token found in transcript panel`);
    return [];
  }
  debug(` Found continuation token, calling get_transcript`);

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
  debug(` Transcript API response keys:`, Object.keys(transcriptData));

  // Parse transcript segments
  const segments =
    transcriptData?.actions?.[0]?.updateEngagementPanelAction?.content
      ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
      ?.transcriptSegmentListRenderer?.initialSegments;

  if (!segments || !Array.isArray(segments)) {
    debug(` No transcript segments found`);
    return [];
  }

  debug(` Found ${segments.length} transcript segments`);

  // Successfully parsing transcript segments

  const subtitles: Subtitle[] = [];
  let debugCount = 0;

  for (const segment of segments) {
    if (segment.transcriptSegmentRenderer) {
      const renderer = segment.transcriptSegmentRenderer;

      // Extract subtitle data

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

      // Log progress for first few segments
      if (debugCount < 5) {
        debug(
          ` Segment: startMs=${startMs}, endMs=${endMs}, text="${text.substring(
            0,
            50
          )}${text.length > 50 ? '...' : ''}"`
        );
        debugCount++;
      }

      if (text.trim()) {
        subtitles.push({
          start: (startMs / 1000).toString(),
          dur: ((endMs - startMs) / 1000).toString(),
          text: he.decode(striptags(text)),
        });
      }
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
    debug(` No caption tracks found in player data`);
    return [];
  }

  debug(` Found ${captionTracks.length} caption tracks`);

  // Find the appropriate subtitle language track
  const subtitle =
    captionTracks.find((track: any) => track.vssId === `.${lang}`) ||
    captionTracks.find((track: any) => track.vssId === `a.${lang}`) ||
    captionTracks.find((track: any) => track.vssId?.includes(`.${lang}`)) ||
    captionTracks[0]; // fallback to first available

  if (!subtitle?.baseUrl) {
    debug(` No suitable caption track found`);
    return [];
  }

  debug(` Using caption track: ${subtitle.vssId}`);

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

  debug(` Caption XML length: ${xmlText.length} characters`);

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
    debug(` Getting video details for ${videoID}, serverless: ${isServerless}`);

    // Get video info using proper InnerTube API
    const { playerData, nextData } = await getVideoInfo(videoID);

    // Extract basic video details
    const videoDetails = playerData?.videoDetails;

    // Extract title from multiple possible locations
    let title = 'No title found';
    if (videoDetails?.title) {
      title = videoDetails.title;
    } else if (
      nextData?.contents?.twoColumnWatchNextResults?.results?.results
        ?.contents?.[0]?.videoPrimaryInfoRenderer?.title?.runs?.[0]?.text
    ) {
      title =
        nextData.contents.twoColumnWatchNextResults.results.results.contents[0]
          .videoPrimaryInfoRenderer.title.runs[0].text;
    } else if (nextData?.metadata?.videoMetadataRenderer?.title?.simpleText) {
      title = nextData.metadata.videoMetadataRenderer.title.simpleText;
    } else if (nextData?.videoDetails?.title) {
      title = nextData.videoDetails.title;
    }

    // Extract description from multiple possible locations
    let description = 'No description found';
    if (videoDetails?.shortDescription) {
      description = videoDetails.shortDescription;
    } else if (
      nextData?.contents?.twoColumnWatchNextResults?.results?.results
        ?.contents?.[1]?.videoSecondaryInfoRenderer?.description?.runs
    ) {
      description =
        nextData.contents.twoColumnWatchNextResults.results.results.contents[1].videoSecondaryInfoRenderer.description.runs
          .map((run: any) => run.text)
          .join('');
    } else if (
      nextData?.contents?.twoColumnWatchNextResults?.results?.results
        ?.contents?.[0]?.videoPrimaryInfoRenderer?.videoActions?.menuRenderer
        ?.topLevelButtons
    ) {
      // Look for description in primary info renderer
      const primaryInfo =
        nextData.contents.twoColumnWatchNextResults.results.results.contents[0]
          .videoPrimaryInfoRenderer;
      if (primaryInfo?.description?.runs) {
        description = primaryInfo.description.runs
          .map((run: any) => run.text)
          .join('');
      }
    } else if (
      nextData?.metadata?.videoMetadataRenderer?.description?.simpleText
    ) {
      description =
        nextData.metadata.videoMetadataRenderer.description.simpleText;
    } else if (nextData?.videoDetails?.shortDescription) {
      description = nextData.videoDetails.shortDescription;
    }

    // Additional search in the secondary info renderer with alternative path
    if (
      description === 'No description found' &&
      nextData?.contents?.twoColumnWatchNextResults?.results?.results?.contents
    ) {
      for (const content of nextData.contents.twoColumnWatchNextResults.results
        .results.contents) {
        if (content?.videoSecondaryInfoRenderer?.description?.runs) {
          description = content.videoSecondaryInfoRenderer.description.runs
            .map((run: any) => run.text)
            .join('');
          break;
        }
        if (
          content?.videoSecondaryInfoRenderer?.attributedDescription?.content
        ) {
          description =
            content.videoSecondaryInfoRenderer.attributedDescription.content;
          break;
        }
      }
    }

    // Search in engagement panels for description
    if (description === 'No description found' && nextData?.engagementPanels) {
      for (const panel of nextData.engagementPanels) {
        if (
          panel?.engagementPanelSectionListRenderer?.content
            ?.structuredDescriptionContentRenderer?.items
        ) {
          const items =
            panel.engagementPanelSectionListRenderer.content
              .structuredDescriptionContentRenderer.items;
          for (const item of items) {
            if (item?.videoDescriptionHeaderRenderer?.description?.runs) {
              description = item.videoDescriptionHeaderRenderer.description.runs
                .map((run: any) => run.text)
                .join('');
              break;
            }
            if (
              item?.expandableVideoDescriptionBodyRenderer?.descriptionBodyText
                ?.runs
            ) {
              description =
                item.expandableVideoDescriptionBodyRenderer.descriptionBodyText.runs
                  .map((run: any) => run.text)
                  .join('');
              break;
            }
          }
          if (description !== 'No description found') break;
        }
      }
    }

    debug(` Video title: ${title}`);
    debug(
      ` Video description: ${description.substring(0, 100)}${
        description.length > 100 ? '...' : ''
      }`
    );

    // Debug: Show available data structures for description
    if (description === 'No description found') {
      debug(` Description not found, checking available structures...`);
      if (
        nextData?.contents?.twoColumnWatchNextResults?.results?.results
          ?.contents
      ) {
        nextData.contents.twoColumnWatchNextResults.results.results.contents.forEach(
          (content: any, index: number) => {
            debug(` Content ${index} keys:`, Object.keys(content || {}));
            if (content?.videoSecondaryInfoRenderer) {
              debug(
                `videoSecondaryInfoRenderer keys:`,
                Object.keys(content.videoSecondaryInfoRenderer || {})
              );
            }
          }
        );
      }
    }

    let subtitles: Subtitle[] = [];

    // Method 1: Try to get transcript from engagement panel (preferred, like YouTube.js)
    if (nextData) {
      try {
        subtitles = await getTranscriptFromEngagementPanel(videoID, nextData);
        if (subtitles.length > 0) {
          debug(
            ` Successfully got ${subtitles.length} subtitles from transcript API`
          );
        }
      } catch (error) {
        debug(
          ` Transcript API failed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    // Method 2: Fallback to traditional caption tracks
    if (subtitles.length === 0) {
      try {
        subtitles = await getSubtitlesFromCaptions(videoID, playerData, lang);
        if (subtitles.length > 0) {
          debug(
            ` Successfully got ${subtitles.length} subtitles from captions`
          );
        }
      } catch (error) {
        debug(
          ` Caption fallback failed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    if (subtitles.length === 0) {
      debug(` No subtitles found for video: ${videoID} (language: ${lang})`);
    }

    return {
      title,
      description,
      subtitles,
    };
  } catch (error) {
    debug(`Error in getVideoDetails:`, error);
    throw error;
  }
};

export const getSubtitles = async ({
  videoID,
  lang = 'en',
}: Options): Promise<Subtitle[]> => {
  try {
    debug(` Getting subtitles for ${videoID}, serverless: ${isServerless}`);

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
        debug(
          ` Transcript API failed:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    // Fallback to captions
    return await getSubtitlesFromCaptions(videoID, playerData, lang);
  } catch (error) {
    debug('Error getting subtitles:', error);
    throw error;
  }
};
