import he from 'he';
import axios from 'axios';
import lodash from 'lodash';
const { find } = lodash;

import striptags from 'striptags';

export const getSubtitles = async ({ videoID, lang = 'en' }) => {
  const { data } = await axios.get(`https://youtube.com/watch?v=${videoID}`);

  if (!data.includes('captionTracks')) {
    console.warn(`No captions found for video: ${videoID}`);
    return [];
  }

  const regex = /({"captionTracks":.*isTranslatable":(true|false)}])/;
  const [match] = regex.exec(data);
  const { captionTracks } = JSON.parse(`${match}}`);

  const subtitle =
    find(captionTracks, { vssId: `.${lang}` }) ||
    find(captionTracks, { vssId: `a.${lang}` }) ||
    find(captionTracks, ({ vssId }) => vssId && vssId.match(`.${lang}`));

  if (!subtitle || (subtitle && !subtitle.baseUrl)) {
    console.warn(`Could not find ${lang} captions for ${videoID}`);
    return [];
  }

  const { data: transcript } = await axios.get(subtitle.baseUrl);
  const lines = transcript
    .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', '')
    .replace('</transcript>', '')
    .split('</text>')
    .filter((line) => line && line.trim())
    .map((line) => {
      const startRegex = /start="([\d.]+)"/;
      const durRegex = /dur="([\d.]+)"/;

      const [, start] = startRegex.exec(line);
      const [, dur] = durRegex.exec(line);

      const htmlText = line
        .replace(/<text.+>/, '')
        .replace(/&amp;/gi, '&')
        .replace(/<\/?[^>]+(>|$)/g, '');

      const decodedText = he.decode(htmlText);
      const text = striptags(decodedText);

      return {
        start,
        dur,
        text,
      };
    });

  return lines;
};
