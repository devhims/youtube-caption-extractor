import { getVideoDetails, VideoDetails, Options } from './index';

describe('getVideoDetails function', () => {
  let videoDetails: VideoDetails;

  beforeAll(async () => {
    const options: Options = { videoID: 'fKxLbERmB4U', lang: 'en' };
    videoDetails = await getVideoDetails(options);
  });

  test('it should return an object with title, description, and subtitles properties', () => {
    console.log('Title: ', videoDetails.title);
    console.log('Description: ', videoDetails.description);
    expect(videoDetails).toHaveProperty('title');
    expect(videoDetails).toHaveProperty('description');
    expect(videoDetails).toHaveProperty('subtitles');
  });

  test('subtitles should be an array', () => {
    // if (Array.isArray(videoDetails.subtitles)) {
    //   console.log('First few subtitles: ', videoDetails.subtitles.slice(0, 5));
    // }
    expect(Array.isArray(videoDetails.subtitles)).toBe(true);
  });
});
