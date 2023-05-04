import he from 'he';
import axios from 'axios';
import lodash from 'lodash';
import striptags from 'striptags';
const { find } = lodash;

export const getSubtitles = async ({ videoID, lang = 'en' }) => {
  // Fetch YouTube video page data
  const { data } = await axios.get(`https://youtube.com/watch?v=${videoID}`);

  // Check if the video page contains captions
  if (!data.includes('captionTracks')) {
    console.warn(`No captions found for video: ${videoID}`);
    return [];
  }

  // Extract caption tracks JSON string from video page data
  const regex = /"captionTracks":(\[.*?\])/;
  const [_, captionTracksJson] = regex.exec(data);
  const captionTracks = JSON.parse(captionTracksJson);

  // Find the appropriate subtitle language track
  const subtitle =
    find(captionTracks, { vssId: `.${lang}` }) ||
    find(captionTracks, { vssId: `a.${lang}` }) ||
    find(captionTracks, ({ vssId }) => vssId && vssId.match(`.${lang}`));

  // Check if the subtitle language track exists
  if (!subtitle?.baseUrl) {
    console.warn(`Could not find ${lang} captions for ${videoID}`);
    return [];
  }

  // Fetch subtitles XML from the subtitle track URL
  const { data: transcript } = await axios.get(subtitle.baseUrl);

  // Define regex patterns for extracting start and duration times
  const startRegex = /start="([\d.]+)"/;
  const durRegex = /dur="([\d.]+)"/;

  // Process the subtitles XML to create an array of subtitle objects
  const lines = transcript
    .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', '')
    .replace('</transcript>', '')
    .split('</text>')
    .filter((line) => line && line.trim())
    .map((line) => {
      // Extract start and duration times using regex patterns
      const [, start] = startRegex.exec(line);
      const [, dur] = durRegex.exec(line);

      // Clean up subtitle text by removing HTML tags and decoding HTML entities
      const htmlText = line
        .replace(/<text.+>/, '')
        .replace(/&amp;/gi, '&')
        .replace(/<\/?[^>]+(>|$)/g, '');
      const decodedText = he.decode(htmlText);
      const text = striptags(decodedText);

      // Create a subtitle object with start, duration, and text properties
      return {
        start,
        dur,
        text,
      };
    });

  return lines;
};
