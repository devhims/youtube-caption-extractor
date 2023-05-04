# YouTube Caption Extractor

A simple and efficient package to scrape and parse captions (subtitles) from YouTube videos, supporting both user-submitted and auto-generated captions with language options.

## Installation

```sh
npm install youtube-caption-extractor
```

## Usage

In a server-side environment or Node.js

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

## Handling CORS issues in client-side applications

When using this package in a client-side application, you might encounter CORS (Cross-Origin Resource Sharing) issues. To handle these issues, it's recommended to create a server-side API route that fetches subtitles on behalf of the client. This way, you can ensure that your application respects CORS policies while still being able to fetch subtitles.

For example, in a Next.js project you can create an API route like this:

1. Create a new file under the pages/api folder, e.g., `pages/api/fetch-subtitles.js`.
2. Inside the `fetch-subtitles.js` file, add the following code:

```js
import { getSubtitles } from 'youtube-caption-extractor';

export default async function handler(req, res) {
  const { videoID, lang } = req.query;

  try {
    const subtitles = await getSubtitles({ videoID, lang });
    res.status(200).json(subtitles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
```

3. Now, in your client-side component, you can fetch subtitles using the API route:

```js
import { useEffect, useState } from 'react';

const MyComponent = () => {
  const [subtitles, setSubtitles] = useState([]);

  const videoID = 'video_id_here';
  const lang = 'en'; // Optional, default is 'en' (English)

  useEffect(() => {
    const fetchSubtitles = async (videoID, lang = 'en') => {
      try {
        const response = await fetch(
          `/api/fetch-subtitles?videoID=${videoID}&lang=${lang}`
        );
        const data = await response.json();
        setSubtitles(data);
      } catch (error) {
        console.error('Error fetching subtitles:', error);
      }
    };

    fetchSubtitles(videoID, lang);
  }, [videoID, lang]);

  // Render your component with the fetched subtitles
};
```

## License

ISC
