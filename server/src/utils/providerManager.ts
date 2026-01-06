/**
 * Manages provider-source integration
 * Handles lazy loading and error handling for provider initialization
 */

let providersInstance: any = null;
let loadPromise: Promise<any> | null = null;

/**
 * Initialize and cache provider instance
 */
export async function getProviderInstance(proxyUrl: string) {
  if (providersInstance) {
    return providersInstance;
  }

  // Use a promise to prevent multiple concurrent initialization attempts
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      console.log('[PROVIDER-SOURCE] Initializing provider instance...');

      // Dynamically import provider-source modules through wrapper
      const { makeProviders, makeSimpleProxyFetcher, makeStandardFetcher, setM3U8ProxyUrl, targets } = await import('./providerWrapper.js');

      setM3U8ProxyUrl(proxyUrl);

      // Create a standard fetcher for normal requests
      const standardFetcher = makeStandardFetcher(fetch);

      // Create a proxy fetcher for proxied requests
      const proxyFetcher = makeSimpleProxyFetcher(proxyUrl, fetch);

      // Initialize providers with both fetchers
      providersInstance = makeProviders({
        fetcher: standardFetcher,
        proxiedFetcher: proxyFetcher,
        target: targets.NATIVE,
      });

      console.log('[PROVIDER-SOURCE] Provider instance initialized successfully');
      return providersInstance;
    } catch (error: any) {
      console.error('[PROVIDER-SOURCE] Failed to initialize:', error.message);
      return null;
    }
  })();

  return loadPromise;
}

/**
 * Check if provider-source is available
 */
export function isProviderSourceAvailable(): boolean {
  return providersInstance !== null;
}

/**
 * Reset provider instance (useful for testing/reloading)
 */
export function resetProviderInstance(): void {
  providersInstance = null;
  loadPromise = null;
  console.log('[PROVIDER-SOURCE] Provider instance reset');
}
