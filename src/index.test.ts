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

  // to run this test, you need to have a proxy server running
  // and update the proxyUrl, proxyPort, proxyUsername, and proxyPassword in the Options

  // test.only('it should use a proxy when provided', async () => {
  //   const options: Options = { videoID: 'GyTwVlce-rM', lang: 'en', proxyUrl: '123.456.789.00', proxyPort: 3128, proxyUsername: 'username', proxyPassword: 'password' };
  //   const videoDetails = await getVideoDetails(options);
  //   console.log('Title: ', videoDetails.title);
  //   console.log('Description: ', videoDetails.description);
  //   console.log('Subtitles: ', videoDetails.subtitles);

  //   expect(videoDetails).toHaveProperty('title');
  //   expect(videoDetails).toHaveProperty('description');
  //   expect(videoDetails).toHaveProperty('subtitles');
  // });
});
