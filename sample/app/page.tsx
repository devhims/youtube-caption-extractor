'use client';

import { useState } from 'react';

const HomePage = () => {
  const [videoID, setVideoID] = useState('');
  const [lang, setLang] = useState('');
  const [subtitles, setSubtitles] = useState([]);
  const [videoDetails, setVideoDetails] = useState<{
    title?: string;
    description?: string;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const fetchData = async () => {
    setIsFetching(true);
    try {
      // Fetch subtitles and video details in parallel
      const [subtitlesResponse, videoDetailsResponse] = await Promise.all([
        fetch(`/api/subtitles?videoID=${videoID}&lang=${lang}`),
        fetch(`/api/videoDetails?videoID=${videoID}&lang=${lang}`),
      ]);

      if (!subtitlesResponse.ok) {
        throw new Error(`Subtitles API Error: ${subtitlesResponse.status}`);
      }
      if (!videoDetailsResponse.ok) {
        throw new Error(
          `Video Details API Error: ${videoDetailsResponse.status}`
        );
      }

      const subtitlesResult = await subtitlesResponse.json();
      const videoDetailsResult = await videoDetailsResponse.json();

      setSubtitles(subtitlesResult.subtitles);
      setVideoDetails(videoDetailsResult.videoDetails);
      setError(null);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred');
      }
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className='min-h-screen bg-gray-100 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8'>
      <div className='max-w-3xl mx-auto'>
        <h1 className='text-3xl font-bold text-center text-gray-900 dark:text-white mb-8'>
          Fetch YouTube Subtitles and Video Details
        </h1>
        <div className='bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 mb-6'>
          <div className='mb-4'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              Video ID:
              <input
                type='text'
                value={videoID}
                onChange={(e) => setVideoID(e.target.value)}
                placeholder='5I1jTJ9sYeA'
                className='h-8 px-2 mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 dark:bg-gray-700 dark:text-white'
              />
            </label>
          </div>
          <div className='mb-4'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              Language:
              <input
                type='text'
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                placeholder='en, es, fr, de, ja, ko, etc.'
                className='h-8 px-2 mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 dark:bg-gray-700 dark:text-white'
              />
            </label>
          </div>
          <button
            onClick={fetchData}
            disabled={isFetching}
            className='w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50 transition duration-150 ease-in-out disabled:opacity-50'
          >
            {isFetching ? 'Fetching...' : 'Fetch Data'}
          </button>
        </div>

        {error && (
          <p className='text-red-600 dark:text-red-400 mb-4'>Error: {error}</p>
        )}
        {subtitles.length > 0 && (
          <div className='bg-white dark:bg-gray-800 shadow-md rounded-lg p-6'>
            <h2 className='text-2xl font-semibold mb-4 text-gray-900 dark:text-white'>
              Title
            </h2>
            <p
              className='mb-2 text-gray-800 dark:text-gray-200'
              dangerouslySetInnerHTML={{ __html: videoDetails.title || '' }}
            ></p>

            <h2 className='text-2xl font-semibold mb-4 text-gray-900 dark:text-white'>
              Description
            </h2>
            <p
              className='mb-4 text-gray-800 dark:text-gray-200'
              dangerouslySetInnerHTML={{
                __html: videoDetails.description || '',
              }}
            ></p>
            <h2 className='text-2xl font-semibold mb-4 text-gray-900 dark:text-white'>
              Subtitles
            </h2>
            <p className='bg-gray-100 dark:bg-gray-700 p-4 rounded-md text-gray-800 dark:text-gray-200'>
              {subtitles
                .map((subtitle: { text: string }) => subtitle.text)
                .join(' ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePage;
