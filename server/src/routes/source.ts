import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getProviderInstance } from '../utils/providerManager.js';

const router = Router();

// Types for stream data
interface StreamQuality {
  quality: string;
  url: string;
}

interface Caption {
  language: string;
  url: string;
  default?: boolean;
}

export interface StreamResponse {
  success: boolean;
  data?: {
    title: string;
    type: 'hls' | 'mp4';
    qualities: StreamQuality[];
    captions: Caption[];
    sourceProvider: string;
    duration?: number;
    headers?: Record<string, string>;
  };
  error?: string;
  fallbacks?: string[];
}


/**
 * Convert provider stream format to our format
 */
function convertStreamToQuality(stream: any): StreamQuality[] {
  const qualities: StreamQuality[] = [];

  try {
    // Handle HLS streams
    if (stream.type === 'hls') {
      const url = stream.playlist;
      if (url) {
        qualities.push({
          quality: stream.quality || 'auto',
          url
        });
      }
    }
    // Handle file-based streams (MP4, WebM, etc.)
    else if (stream.type === 'file') {
      if (stream.file && stream.file.url) {
        qualities.push({
          quality: stream.quality || 'auto',
          url: stream.file.url
        });
      }
    }
  } catch (error) {
    console.error('Error converting stream:', error);
  }

  return qualities;
}

/**
 * Build headers object from stream if needed
 */
function getStreamHeaders(stream: any): Record<string, string> {
  const headers: Record<string, string> = {};

  if (stream.headers && typeof stream.headers === 'object') {
    Object.entries(stream.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    });
  }

  return headers;
}

/**
 * Extract captions from provider output
 */
function extractCaptions(output: any): Caption[] {
  const captions: Caption[] = [];

  try {
    if (output.captions && Array.isArray(output.captions)) {
      output.captions.forEach((caption: any, index: number) => {
        captions.push({
          language: caption.label || caption.language || `Subtitle ${index + 1}`,
          url: caption.url || caption.src || '',
          default: index === 0
        });
      });
    }
  } catch (error) {
    console.error('Error extracting captions:', error);
  }

  return captions;
}

/**
 * Get stream URLs for a movie or TV episode
 * Query params:
 * - tmdbId: TMDB ID of the media (required)
 * - type: 'movie' or 'tv' (required)
 * - season: Season number (required for TV)
 * - episode: Episode number (required for TV)
 * - quality: Preferred quality (optional) - 'best', '1080p', '720p', '480p', 'auto'
 */
router.get('/get', async (req: Request, res: Response) => {
  try {
    const { tmdbId, type, season, episode, quality = 'auto' } = req.query;
    const config = (req as any).config;

    // Validation
    if (!tmdbId || !type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tmdbId and type'
      });
    }

    if (type !== 'movie' && type !== 'tv') {
      return res.status(400).json({
        success: false,
        error: 'Type must be "movie" or "tv"'
      });
    }

    if (type === 'tv' && (!season || !episode)) {
      return res.status(400).json({
        success: false,
        error: 'Season and episode are required for TV shows'
      });
    }

    try {
      // Try to use provider-source if available
      let isUsingProviderSource = false;

      try {
        // Fetch metadata from TMDB to get title and release year
        let tmdbData: any = {};
        try {
          const tmdbEndpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
          const tmdbResponse = await axios.get(
            `${config.tmdbBaseUrl}${tmdbEndpoint}`,
            {
              params: {
                api_key: config.tmdbApiKey
              },
              timeout: 5000
            }
          );
          tmdbData = tmdbResponse.data;
          console.log(`[TMDB] Fetched metadata for ${type} ${tmdbId}`);
        } catch (tmdbError: any) {
          console.warn(`[TMDB] Could not fetch metadata: ${tmdbError.message}`);
        }

        // Initialize providers
        const providers = await getProviderInstance(config.proxyUrl);

        if (!providers) {
          throw new Error('Provider-source not available');
        }

        // Build media object for provider with TMDB metadata
        const media = {
          type: type === 'movie' ? 'movie' : 'show',
          tmdbId: String(tmdbId), // tmdbId must be a string
          title: tmdbData.title || tmdbData.name || undefined,
          releaseYear: tmdbData.release_date
            ? new Date(tmdbData.release_date).getFullYear()
            : tmdbData.first_air_date
            ? new Date(tmdbData.first_air_date).getFullYear()
            : undefined,
          ...(type === 'tv' && {
            season: {
              number: Number(season)
            },
            episode: {
              number: Number(episode)
            }
          })
        };

        console.log(`[STREAM] Scraping ${type} ${tmdbId}${type === 'tv' ? ` S${season}E${episode}` : ''} - ${media.title || 'Unknown'}`);

        // Run all providers to get the first available stream
        console.log(`[SCRAPER] Starting runAll with media:`, JSON.stringify(media));

        let result;
        try {
          // Create a promise that resolves after a timeout
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Provider scraping timeout after 30 seconds')), 30000)
          );

          // Race between runAll and timeout
          result = await Promise.race([
            providers.runAll({
              media
            }),
            timeoutPromise
          ]);

          console.log(`[SCRAPER] runAll completed:`, result ? `Found stream from ${result.sourceId}` : 'No stream found');
        } catch (err: any) {
          console.error(`[SCRAPER] runAll error:`, err.message);
          if (err.stack) console.error(`[SCRAPER] Stack:`, err.stack);
          result = null;
        }

        if (result && result.stream) {
          isUsingProviderSource = true;

          // Extract captions from the stream
          const captions: Caption[] = [];
          if (result.stream.captions && Array.isArray(result.stream.captions)) {
            result.stream.captions.forEach((caption: any, index: number) => {
              captions.push({
                language: caption.language || `Subtitle ${index + 1}`,
                url: caption.url || '',
                default: index === 0
              });
            });
          }

          // Build qualities array based on stream type
          const qualitiesArray: StreamQuality[] = [];
          let streamType: 'hls' | 'mp4' = 'mp4';

          if (result.stream.type === 'hls') {
            streamType = 'hls';
            if (result.stream.playlist) {
              qualitiesArray.push({
                quality: 'auto',
                url: result.stream.playlist
              });
            }
          } else if (result.stream.type === 'file') {
            streamType = 'mp4';
            // Extract qualities from file stream
            if (result.stream.qualities) {
              Object.entries(result.stream.qualities).forEach(([quality, fileData]: [string, any]) => {
                if (fileData && fileData.url) {
                  qualitiesArray.push({
                    quality: quality || 'auto',
                    url: fileData.url
                  });
                }
              });
            }
          }

          // If we have qualities, return success response
          if (qualitiesArray.length > 0) {
            const headers = getStreamHeaders(result.stream);

            const response: StreamResponse = {
              success: true,
              data: {
                title: media.tmdbId.toString(),
                type: streamType,
                qualities: qualitiesArray,
                captions,
                sourceProvider: result.sourceId || 'unknown',
                duration: undefined,
                ...(Object.keys(headers).length > 0 && { headers })
              },
              fallbacks: ['videasy.net', 'vidlink.pro', 'vidsrc.pro']
            };

            console.log(`[STREAM] Success: ${qualitiesArray.length} quality options found from ${result.sourceId}`);
            return res.json(response);
          }
        } else {
          console.log(`[SCRAPER] runAll returned no stream, will try individual sources`);

          // Try to scrape individual sources as fallback
          const sources = ['8stream', 'ee3', 'streambox', 'soapertv', 'whvxMirrors'];

          for (const sourceId of sources) {
            try {
              console.log(`[SCRAPER] Trying source: ${sourceId}`);

              const sourceResult = await providers.runSourceScraper({
                id: sourceId,
                media
              });

              console.log(`[SCRAPER] Source ${sourceId} result:`, sourceResult ? 'Found embeds/stream' : 'Nothing found');

              // Check if source found a direct stream
              if (sourceResult && sourceResult.stream) {
                console.log(`[SCRAPER] Found direct stream from ${sourceId}`);

                const captions: Caption[] = [];
                if (sourceResult.stream.captions && Array.isArray(sourceResult.stream.captions)) {
                  sourceResult.stream.captions.forEach((caption: any, index: number) => {
                    captions.push({
                      language: caption.language || `Subtitle ${index + 1}`,
                      url: caption.url || '',
                      default: index === 0
                    });
                  });
                }

                const qualitiesArray: StreamQuality[] = [];
                let streamType: 'hls' | 'mp4' = 'mp4';

                if (sourceResult.stream.type === 'hls') {
                  streamType = 'hls';
                  if (sourceResult.stream.playlist) {
                    qualitiesArray.push({
                      quality: 'auto',
                      url: sourceResult.stream.playlist
                    });
                  }
                } else if (sourceResult.stream.type === 'file') {
                  streamType = 'mp4';
                  if (sourceResult.stream.qualities) {
                    Object.entries(sourceResult.stream.qualities).forEach(([quality, fileData]: [string, any]) => {
                      if (fileData && fileData.url) {
                        qualitiesArray.push({
                          quality: quality || 'auto',
                          url: fileData.url
                        });
                      }
                    });
                  }
                }

                if (qualitiesArray.length > 0) {
                  const headers = getStreamHeaders(sourceResult.stream);
                  const response: StreamResponse = {
                    success: true,
                    data: {
                      title: media.tmdbId.toString(),
                      type: streamType,
                      qualities: qualitiesArray,
                      captions,
                      sourceProvider: sourceId,
                      duration: undefined,
                      ...(Object.keys(headers).length > 0 && { headers })
                    },
                    fallbacks: ['videasy.net', 'vidlink.pro', 'vidsrc.pro']
                  };

                  console.log(`[STREAM] Success from fallback: ${qualitiesArray.length} quality options found from ${sourceId}`);
                  return res.json(response);
                }
              }

              // Check for embeds
              if (sourceResult && sourceResult.embeds && sourceResult.embeds.length > 0) {
                console.log(`[SCRAPER] Source ${sourceId} found ${sourceResult.embeds.length} embed(s), will try them`);

                // Try the first embed
                const embed = sourceResult.embeds[0];
                try {
                  const embedResult = await providers.runEmbedScraper({
                    id: embed.embedId,
                    url: embed.url
                  });

                  if (embedResult && embedResult.stream) {
                    console.log(`[SCRAPER] Found stream from embed ${embed.embedId}`);

                    const captions: Caption[] = [];
                    if (embedResult.stream.captions && Array.isArray(embedResult.stream.captions)) {
                      embedResult.stream.captions.forEach((caption: any, index: number) => {
                        captions.push({
                          language: caption.language || `Subtitle ${index + 1}`,
                          url: caption.url || '',
                          default: index === 0
                        });
                      });
                    }

                    const qualitiesArray: StreamQuality[] = [];
                    let streamType: 'hls' | 'mp4' = 'mp4';

                    if (embedResult.stream.type === 'hls') {
                      streamType = 'hls';
                      if (embedResult.stream.playlist) {
                        qualitiesArray.push({
                          quality: 'auto',
                          url: embedResult.stream.playlist
                        });
                      }
                    } else if (embedResult.stream.type === 'file') {
                      streamType = 'mp4';
                      if (embedResult.stream.qualities) {
                        Object.entries(embedResult.stream.qualities).forEach(([quality, fileData]: [string, any]) => {
                          if (fileData && fileData.url) {
                            qualitiesArray.push({
                              quality: quality || 'auto',
                              url: fileData.url
                            });
                          }
                        });
                      }
                    }

                    if (qualitiesArray.length > 0) {
                      const headers = getStreamHeaders(embedResult.stream);
                      const response: StreamResponse = {
                        success: true,
                        data: {
                          title: media.tmdbId.toString(),
                          type: streamType,
                          qualities: qualitiesArray,
                          captions,
                          sourceProvider: `${sourceId} → ${embed.embedId}`,
                          duration: undefined,
                          ...(Object.keys(headers).length > 0 && { headers })
                        },
                        fallbacks: ['videasy.net', 'vidlink.pro', 'vidsrc.pro']
                      };

                      console.log(`[STREAM] Success from embed: ${qualitiesArray.length} quality options found`);
                      return res.json(response);
                    }
                  }
                } catch (embedError: any) {
                  console.warn(`[SCRAPER] Embed ${embed.embedId} scraping failed: ${embedError.message}`);
                  continue;
                }
              }
            } catch (sourceError: any) {
              console.warn(`[SCRAPER] Source ${sourceId} failed: ${sourceError.message}`);
              continue;
            }
          }
        }
      } catch (scraperError: any) {
        console.warn(`[SCRAPER] Provider source unavailable or failed: ${scraperError.message}`);
      }

      // If provider-source is not available or failed, return fallback response
      if (!isUsingProviderSource) {
        console.log(`[STREAM] Falling back to embedded players for ${type} ${tmdbId}`);
        return res.status(200).json({
          success: false,
          error: 'Real stream scraping unavailable, using embedded players',
          fallbacks: ['videasy.net', 'vidlink.pro', 'vidsrc.pro', 'superembed']
        });
      }

    } catch (error: any) {
      console.error('[STREAM ERROR]', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch streams',
        fallbacks: ['videasy.net', 'vidlink.pro', 'vidsrc.pro']
      });
    }

  } catch (error: any) {
    console.error('Error fetching streams:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch streams'
    });
  }
});

/**
 * Get available sources/providers
 */
router.get('/providers', (req: Request, res: Response) => {
  const providers = [
    { id: 'videasy', name: 'Videasy', priority: 1 },
    { id: 'vidlink', name: 'Vid Link', priority: 2 },
    { id: 'vidsrc', name: 'VidSrc', priority: 3 },
    { id: 'superembed', name: 'Super Embed', priority: 4 }
  ];

  res.json({
    success: true,
    data: providers
  });
});

/**
 * Debug endpoint to test provider initialization and list available sources
 */
router.get('/debug', async (req: Request, res: Response) => {
  try {
    const config = (req as any).config;

    const providers = await getProviderInstance(config.proxyUrl);

    if (!providers) {
      return res.json({
        success: false,
        error: 'Failed to initialize providers',
        status: 'Provider initialization failed'
      });
    }

    // Try to list available sources
    let sources: any[] = [];
    let embeds: any[] = [];

    try {
      sources = providers.listSources?.() || [];
      console.log('[DEBUG] Available sources:', sources);
    } catch (e: any) {
      console.log('[DEBUG] Could not list sources:', e.message);
    }

    try {
      embeds = providers.listEmbeds?.() || [];
      console.log('[DEBUG] Available embeds:', embeds);
    } catch (e: any) {
      console.log('[DEBUG] Could not list embeds:', e.message);
    }

    res.json({
      success: true,
      status: 'Provider initialized successfully',
      sourcesCount: sources.length,
      embedsCount: embeds.length,
      sources: sources.slice(0, 5), // Return first 5 sources
      embeds: embeds.slice(0, 5)    // Return first 5 embeds
    });
  } catch (error: any) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      status: 'Debug endpoint error'
    });
  }
});

/**
 * Proxy endpoint for proxying requests through the external proxy
 * This helps bypass CORS and geo-blocking
 */
router.post('/proxy', async (req: Request, res: Response) => {
  try {
    const { url, headers = {} } = req.body;
    const config = (req as any).config;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    // Create proxy request through the external proxy service
    const proxyUrl = new URL(config.proxyUrl);
    proxyUrl.searchParams.set('url', url);

    const response = await axios.get(proxyUrl.toString(), {
      headers: {
        ...headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000,
      responseType: 'stream'
    });

    // Forward headers and content
    Object.keys(response.headers).forEach(key => {
      if (['content-type', 'content-length', 'content-range'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });

    response.data.pipe(res);
  } catch (error: any) {
    console.error('Proxy error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Proxy request failed'
    });
  }
});

export { router as sourceRoutes };
