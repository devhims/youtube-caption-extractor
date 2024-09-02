import he from 'he';
import striptags from 'striptags';
import axios from 'axios';
import https from 'https';
import tunnel from 'tunnel';

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
  proxyUrl?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
}

export interface VideoDetails {
  title: string;
  description: string;
  subtitles: Subtitle[];
}

const createClient = (proxyUrl: string = '', proxyPort: number = 0, proxyUsername: string = '', proxyPassword: string = '') => {
  if (proxyUrl.length > 0 && proxyPort > 0) {
    const agent = tunnel.httpsOverHttp({
      proxy: {
        host: proxyUrl,
        port: proxyPort,
        proxyAuth: proxyUsername && proxyPassword ? `${proxyUsername}:${proxyPassword}` : undefined,
      },
    });

    return axios.create({ httpsAgent: agent });
  }

  return axios.create();
};

export const getVideoDetails = async ({
  videoID,
  lang = 'en',
  proxyUrl = '',
  proxyPort = 0,
  proxyUsername = '',
  proxyPassword = '',
}: Options): Promise<VideoDetails> => {

  const client = createClient(proxyUrl, proxyPort, proxyUsername, proxyPassword);

  const { data } = await client.get(`https://youtube.com/watch?v=${videoID}`);

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
  const subtitlesResponse = await fetch(subtitle.baseUrl);
  const transcript = await subtitlesResponse.text();

  // Define regex patterns for extracting start and duration times
  const startRegex = /start="([\d.]+)"/;
  const durRegex = /dur="([\d.]+)"/;

  // Process the subtitles XML to create an array of subtitle objects
  const lines = transcript
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

  return {
    title,
    description,
    subtitles: lines,
  };
};

export const getSubtitles = async ({
  videoID,
  lang = 'en',
  proxyUrl = '',
  proxyPort = 0,
  proxyUsername = '',
  proxyPassword = '',
}: Options): Promise<Subtitle[]> => {

  const client = createClient(proxyUrl, proxyPort, proxyUsername, proxyPassword);

  // Fetch YouTube video page data
  const { data } = await client.get(`https://youtube.com/watch?v=${videoID}`);

  // Check if the video page contains captions
  if (!data.includes('captionTracks')) {
    console.warn(`No captions found for video: ${videoID}`);
    return [];
  }

  // Extract caption tracks JSON string from video page data
  const regex = /"captionTracks":(\[.*?\])/;
  const regexResult = regex.exec(data);

  if (!regexResult) {
    console.warn(`Failed to extract captionTracks from video: ${videoID}`);
    return [];
  }

  const [_, captionTracksJson] = regexResult;
  const captionTracks = JSON.parse(captionTracksJson);

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
  const subtitlesResponse = await fetch(subtitle.baseUrl);
  const transcript = await subtitlesResponse.text();

  // Define regex patterns for extracting start and duration times
  const startRegex = /start="([\d.]+)"/;
  const durRegex = /dur="([\d.]+)"/;

  // Process the subtitles XML to create an array of subtitle objects
  const lines = transcript
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

  return lines;
};
