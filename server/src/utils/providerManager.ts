/**
 * Manages @movie-web/providers integration
 * Handles lazy loading and error handling for provider initialization
 */

import { makeProviders, makeSimpleProxyFetcher, makeStandardFetcher, targets } from '@movie-web/providers';

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
      console.log('[PROVIDER-SOURCE] Proxy URL:', proxyUrl);

      // Create a standard fetcher for normal requests
      const standardFetcher = makeStandardFetcher(fetch);
      console.log('[PROVIDER-SOURCE] Standard fetcher created');

      // Create a proxy fetcher for proxied requests
      const proxyFetcher = makeSimpleProxyFetcher(proxyUrl, fetch);
      console.log('[PROVIDER-SOURCE] Proxy fetcher created');

      // Initialize providers with both fetchers
      providersInstance = makeProviders({
        fetcher: standardFetcher,
        proxiedFetcher: proxyFetcher,
        target: targets.NATIVE,
      });

      console.log('[PROVIDER-SOURCE] Provider instance created');

      // Test if providers are available by trying to list sources
      try {
        const sources = providersInstance.listSources?.();
        console.log('[PROVIDER-SOURCE] Available sources:', sources);
      } catch (e) {
        console.log('[PROVIDER-SOURCE] Could not list sources (method may not exist)');
      }

      console.log('[PROVIDER-SOURCE] Provider instance initialized successfully');
      return providersInstance;
    } catch (error: any) {
      console.error('[PROVIDER-SOURCE] Failed to initialize:', error.message, error.stack);
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
