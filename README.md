# YouTube Caption Extractor

A simple and efficient package to scrape and parse captions (subtitles) from YouTube videos, supporting both user-submitted and auto-generated captions with language options.

## Installation

```sh
npm install youtube-caption-extractor
```

## Usage

```js
import { getSubtitles } from 'youtube-caption-extractor';

const fetchSubtitles = async (videoID, lang = 'en') => {
  try {
    const subtitles = await getSubtitles({ videoID, lang });
    console.log(subtitles);
  } catch (error) {
    console.error('Error fetching subtitles:', error);
  }
};

const videoID = 'video_id_here';
const lang = 'en'; // Optional, default is 'en' (English)

fetchSubtitles(videoID, lang);
```

## API

### getSubtitles({ videoID, lang })

- `videoID` (string) - The YouTube video ID
- `lang` (string) - Optional, the language code for the subtitles (e.g., 'en', 'fr', 'de'). Default is 'en' (English)

Returns a promise that resolves to an array of subtitle objects with the following properties:

- `start` (string) - The start time of the caption in seconds
- `dur` (string) - The duration of the caption in seconds
- `text` (string) - The text content of the caption

## License

ISC
