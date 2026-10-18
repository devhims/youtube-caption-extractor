import { getSubtitles } from 'youtube-caption-extractor';
import { NextResponse, type NextRequest } from 'next/server';
import { proxyCaptionApi } from '../_lib/captionApiProxy';
import { handleApiError } from '../_lib/handleError';

// Leave room for the proxy's shared 50-second deadline and an error response.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoID = searchParams.get('videoID');
  const lang = searchParams.get('lang') || 'en';

  if (!videoID) {
    return NextResponse.json(
      { code: 'missing_video_id', message: 'Missing videoID' },
      { status: 400 }
    );
  }

  const proxied = await proxyCaptionApi('/api/subtitles', searchParams);
  if (proxied) return proxied;

  try {
    const subtitles = await getSubtitles({ videoID, lang });
    return NextResponse.json({ subtitles }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
