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

const YT_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?key='; // api key appended

async function fetchCaptionTracks(videoID: string) {
  // 1) Pull the watch page
  const watchHTML = await (await fetch(`https://www.youtube.com/watch?v=${videoID}`)).text();

  // 2) Grab the InnerTube API key
  const keyMatch = watchHTML.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  if (!keyMatch) throw new Error('INNERTUBE_API_KEY not found – YouTube layout changed');
  const apiKey = keyMatch[1];

  // 3) Call the InnerTube player endpoint
  const innertubeResp = await fetch(`${YT_PLAYER_URL}${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
      videoId: videoID,
    }),
  });
  const playerData = await innertubeResp.json();

  // 4) Return captionTracks (or empty array)
  return (
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  );
}


function extracted(transcript: string, startRegex: RegExp, durRegex: RegExp) {
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
  const response = await fetch(`https://youtube.com/watch?v=${videoID}`);
  const data = await response.text();

  // Extract title and description from the page data
  const titleMatch = data.match(
    /<meta name="title" content="([^"]*|[^"]*[^&]quot;[^"]*)">/
  );
  const descriptionMatch = data.match(
    /<meta name="description" content="([^"]*|[^"]*[^&]quot;[^"]*)">/
  );

  const title = titleMatch ? titleMatch[1] : 'No title found';
  const description = descriptionMatch
    ? descriptionMatch[1]
    : 'No description found';

  // Retrieve caption tracks via InnerTube (watch-page no longer holds them)
  const captionTracks = await fetchCaptionTracks(videoID);
  if (!captionTracks.length) {
    console.warn(`No captions found for video: ${videoID}`);
    return { title, description, subtitles: [] };
  }

  // Find the appropriate subtitle language track
  const subtitle =
    captionTracks.find((track: CaptionTrack) => track.vssId === `.${lang}`) ||
    captionTracks.find((track: CaptionTrack) => track.vssId === `a.${lang}`) ||
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
  const transcript = await subtitlesResponse.text();

  // Define regex patterns for extracting start and duration times
  const startRegex = /start="([\d.]+)"/;
  const durRegex = /dur="([\d.]+)"/;

  // Process the subtitles XML to create an array of subtitle objects
  const lines = extracted(transcript, startRegex, durRegex);

  return {
    title,
    description,
    subtitles: lines,
  };
};

export const getSubtitles = async ({
  videoID,
  lang = 'en',
}: Options): Promise<Subtitle[]> => {
  // Directly obtain caption tracks (faster & future-proof)
  const captionTracks = await fetchCaptionTracks(videoID);
  if (!captionTracks.length) {
    console.warn(`No captions found for video: ${videoID}`);
    return [];
  }

  // Find the appropriate subtitle language track
  const subtitle =
    captionTracks.find((track: CaptionTrack) => track.vssId === `.${lang}`) ||
    captionTracks.find((track: CaptionTrack) => track.vssId === `a.${lang}`) ||
    captionTracks.find(
      (track: CaptionTrack) => track.vssId && track.vssId.match(`.${lang}`)
    );

  // Check if the subtitle language track exists
  if (!subtitle?.baseUrl) {
    console.warn(`Could not find ${lang} captions for ${videoID}`);
    return [];
  }

  // Fetch subtitles XML from the subtitle track URL
  const subtitlesResponse = await fetch(subtitle.baseUrl.replace('&fmt=srv3', ''));
  const transcript = await subtitlesResponse.text();

  // Define regex patterns for extracting start and duration times
  const startRegex = /start="([\d.]+)"/;
  const durRegex = /dur="([\d.]+)"/;

  // Process the subtitles XML to create an array of subtitle objects
  return extracted(transcript, startRegex, durRegex);
};
