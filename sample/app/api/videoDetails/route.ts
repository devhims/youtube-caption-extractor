import { getVideoDetails } from 'youtube-caption-extractor';
import { NextResponse } from 'next/server';
import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const videoID = searchParams.get('videoID');
  const lang = searchParams.get('lang') || 'en';

  if (!videoID) {
    return NextResponse.json({ error: 'Missing videoID' }, { status: 400 });
  }

  try {
    const videoDetails = await getVideoDetails({ videoID, lang });
    return NextResponse.json({ videoDetails }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
