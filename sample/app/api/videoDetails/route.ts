// pages/api/videoDetails.ts
import { type NextRequest } from 'next/server';
import he from 'he';
import striptags from 'striptags';
import { NextResponse } from 'next/server';

interface Subtitle {
  start: string;
  dur: string;
  text: string;
}

interface CaptionTrack {
  baseUrl: string;
  vssId: string;
}

interface VideoDetails {
  title: string;
  description: string;
  subtitles: Subtitle[];
}

const fetchWithUserAgent = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response;
};

const getVideoDetails = async (
  videoID: string,
  lang: string = 'en'
): Promise<VideoDetails> => {
  try {
    console.log(`Fetching video details for ID: ${videoID}`);
    const response = await fetchWithUserAgent(
      `https://youtube.com/watch?v=${videoID}`
    );
    const data = await response.text();

    console.log(`Response length: ${data.length}`);
    console.log(
      `Response includes 'captionTracks': ${data.includes('captionTracks')}`
    );

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

    console.log(`Title: ${title}`);
    console.log(`Description: ${description}`);

    // Check if the video page contains captions
    if (!data.includes('captionTracks')) {
      console.warn(`No captions found for video: ${videoID}`);
      return {
        title,
        description,
        subtitles: [],
      };
    }

    // Extract caption tracks JSON string from video page data
    const regex = /"captionTracks":(\[.*?\])/;
    const regexResult = regex.exec(data);

    if (!regexResult) {
      console.warn(`Failed to extract captionTracks from video: ${videoID}`);
      return {
        title,
        description,
        subtitles: [],
      };
    }

    const [_, captionTracksJson] = regexResult;
    const captionTracks = JSON.parse(captionTracksJson);

    console.log(`Found ${captionTracks.length} caption tracks`);

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

    console.log(`Fetching subtitles from URL: ${subtitle.baseUrl}`);

    // Fetch subtitles XML from the subtitle track URL
    const subtitlesResponse = await fetchWithUserAgent(subtitle.baseUrl);
    const transcript = await subtitlesResponse.text();

    console.log(`Subtitle response length: ${transcript.length}`);

    // Define regex patterns for extracting start and duration times
    const startRegex = /start="([\d.]+)"/;
    const durRegex = /dur="([\d.]+)"/;

    // Process the subtitles XML to create an array of subtitle objects
    const subtitles = transcript
      .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', '')
      .replace('</transcript>', '')
      .split('</text>')
      .filter((line: string) => line && line.trim())
      .reduce((acc: Subtitle[], line: string) => {
        // Extract start and duration times using regex patterns
        const startResult = startRegex.exec(line);
        const durResult = durRegex.exec(line);

        if (!startResult || !durResult) {
          console.warn(
            `Failed to extract start or duration from line: ${line}`
          );
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

    return {
      title,
      description,
      subtitles,
    };
  } catch (error) {
    // console.error(`Error in getVideoDetails: ${error.message}`);
    throw error;
  }
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoID = searchParams.get('videoID');
  const lang = searchParams.get('lang') || 'en';

  if (!videoID) {
    return NextResponse.json({ error: 'Missing videoID' }, { status: 400 });
  }

  try {
    const videoDetails = await getVideoDetails(videoID, lang);
    return NextResponse.json({ videoDetails }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
