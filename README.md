# YouTube Caption Extractor

A lightweight package to scrape and parse captions (subtitles) from YouTube videos, supporting both user-submitted and auto-generated captions with language options. In addition, it can also retrieve the title and description of the YouTube video.

## What's new in latest version (v1.9.0)

- **🎯 TypeScript Export Fix**: The `Subtitle` interface is now properly exported, allowing TypeScript users to import and use it for type annotations
- **🔇 Universal Debug Logging**: Replaced console.log pollution with a lightweight, universal debug logger that works in all environments (Node.js, Cloudflare Workers, Edge Runtime)
- **📦 Silent by Default**: Library now produces zero log output in production, making it ideal for MCP servers

## What's new in v1.8.1

- **Enhanced Serverless Support**: Robust serverless deployment compatibility with automatic environment detection
- **Improved Data Extraction**: Multi-location search for video titles and descriptions with comprehensive fallback strategies
- **Modern Transcript API**: Integration with YouTube's engagement panel transcript system for better subtitle extraction
- **Bot Detection Bypass**: Advanced session management and header fingerprinting to avoid YouTube's anti-bot measures
- **Dual Extraction Methods**: Automatic fallback between XML captions and JSON transcript APIs
- **Better Error Handling**: Graceful degradation and detailed debugging for production troubleshooting

## What's new in v1.4.2

- TypeScript batteries included 🔋: The package is now shipped with TypeScript type definitions, making it easier to use in TypeScript projects.
- Node.js and Edge runtime support: The package now supports both Node.js and Edge runtime environments, expanding its usability across different platforms.
- Enhanced data extraction: The new `getVideoDetails` API can fetch not just the subtitles, but also the video's title and description.

## Installation

```sh
npm install youtube-caption-extractor
```

## Usage

In a server-side environment or Node.js

```js
import {
  getSubtitles,
  getVideoDetails,
  Subtitle,
} from 'youtube-caption-extractor';

// Fetching Subtitles
const fetchSubtitles = async (videoID, lang = 'en') => {
  try {
    const subtitles = await getSubtitles({ videoID, lang });
    console.log(subtitles);
  } catch (error) {
    console.error('Error fetching subtitles:', error);
  }
};

// Fetching Video Details
const fetchVideoDetails = async (videoID, lang = 'en') => {
  try {
    const videoDetails = await getVideoDetails({ videoID, lang });
    console.log(videoDetails);
  } catch (error) {
    console.error('Error fetching video details:', error);
  }
};

const videoID = 'video_id_here';
const lang = 'en'; // Optional, default is 'en' (English)

fetchSubtitles(videoID, lang);
fetchVideoDetails(videoID, lang);
```

### TypeScript Usage

```typescript
import {
  getSubtitles,
  getVideoDetails,
  Subtitle,
  VideoDetails,
} from 'youtube-caption-extractor';

const fetchSubtitles = async (
  videoID: string,
  lang = 'en'
): Promise<Subtitle[]> => {
  try {
    const subtitles: Subtitle[] = await getSubtitles({ videoID, lang });
    console.log(subtitles);
    return subtitles;
  } catch (error) {
    console.error('Error fetching subtitles:', error);
    return [];
  }
};

const fetchVideoDetails = async (
  videoID: string,
  lang = 'en'
): Promise<VideoDetails> => {
  try {
    const details: VideoDetails = await getVideoDetails({ videoID, lang });
    console.log(details);
    return details;
  } catch (error) {
    console.error('Error fetching video details:', error);
    throw error;
  }
};
```

### Debug Logging

The library includes a lightweight, universal debug logger that works in all environments (Node.js, Cloudflare Workers, Edge Runtime, etc.). By default, it's silent in production.

```bash
# Enable debug logging
DEBUG=youtube-caption-extractor node your-script.js

# Or using npm scripts
npm run test:debug

# Works in edge environments too
DEBUG=youtube-caption-extractor wrangler dev
```

**Edge Runtime Compatibility**: Unlike many logging libraries, our universal logger has zero Node.js dependencies and works seamlessly in Cloudflare Workers, Vercel Edge Functions, and other edge computing environments.

## API

### getSubtitles({ videoID, lang })

- `videoID` (string) - The YouTube video ID
- `lang` (string) - Optional, the language code for the subtitles (e.g., 'en', 'fr', 'de'). Default is 'en' (English)

Returns a promise that resolves to an array of subtitle objects with the following properties:

- `start` (string) - The start time of the caption in seconds
- `dur` (string) - The duration of the caption in seconds
- `text` (string) - The text content of the caption

### getVideoDetails({ videoID, lang })

- `videoID` (string) - The YouTube video ID
- `lang` (string) - Optional, the language code for the subtitles (e.g., 'en', 'fr', 'de'). Default is 'en' (English)

Returns a promise that resolves to a VideoDetails object with the following properties:

- `title` (string) - The title of the video
- `description` (string) - The description of the video
- `subtitles (Subtitle[])` - An array of subtitle objects

### Exported Types

The following TypeScript interfaces are exported for your use:

```typescript
interface Subtitle {
  start: string; // Start time in seconds
  dur: string; // Duration in seconds
  text: string; // Caption text content
}

interface VideoDetails {
  title: string; // Video title
  description: string; // Video description
  subtitles: Subtitle[]; // Array of subtitle objects
}
```

**Note:** The package automatically detects the deployment environment and uses the most appropriate method for data extraction. In serverless environments, it uses YouTube's engagement panel API for enhanced compatibility.

## Deployment Environments

This package is optimized for both traditional server and serverless environments:

- **✅ Local Development**: Full access to YouTube APIs with traditional caption extraction
- **✅ Traditional Servers**: Works seamlessly with standard Node.js deployments
- **✅ Serverless Platforms**: Auto-detects and adapts for Vercel, AWS Lambda, Netlify
- **✅ Edge Runtime**: Full compatibility with Cloudflare Workers, Vercel Edge Functions, and other edge computing environments
- **✅ Zero Node.js Dependencies**: Universal logging system works across all JavaScript runtimes

## Handling CORS issues in client-side applications

When using this package in a client-side application, you might encounter CORS (Cross-Origin Resource Sharing) issues. To handle these issues, it's recommended to create a server-side API route that fetches subtitles on behalf of the client. This way, you can ensure that your application respects CORS policies while still being able to fetch subtitles and video details.

For example, in a Next.js project you can create an API route like this:

1. Create a new file under the pages/api folder, e.g., `pages/api/fetch-subtitles.js`.
2. Inside the `fetch-subtitles.js` file, add the following code:

```js
import { getSubtitles, getVideoDetails } from 'youtube-caption-extractor';

export default async function handler(req, res) {
  const { videoID, lang } = req.query;

  try {
    const subtitles = await getSubtitles({ videoID, lang }); // call this if you only need the subtitles
    const videoDetails = await getVideoDetails({ videoID, lang }); // call this if you need the video title and description, along with the subtitles
    res.status(200).json({ subtitles, videoDetails });
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
  const [videoDetails, setVideoDetails] = useState({});

  const videoID = 'video_id_here';
  const lang = 'en'; // Optional, default is 'en' (English)

  useEffect(() => {
    const fetchSubtitles = async (videoID, lang = 'en') => {
      try {
        const response = await fetch(
          `/api/fetch-subtitles?videoID=${videoID}&lang=${lang}`
        );
        const data = await response.json();
        setSubtitles(data.subtitles);
        setVideoDetails(data.videoDetails);
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
