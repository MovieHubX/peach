/**
 * Manages @movie-web/providers integration
 * Handles lazy loading and error handling for provider initialization
 */

import { makeSimpleProxyFetcher, makeStandardFetcher, targets } from '@movie-web/providers';
import * as providersLib from '@movie-web/providers';

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

      // Try to use buildProviders if available, otherwise use makeProviders
      console.log('[PROVIDER-SOURCE] Checking available initialization methods...');

      if (typeof providersLib.buildProviders === 'function') {
        console.log('[PROVIDER-SOURCE] Using buildProviders with addBuiltinProviders...');

        providersInstance = (providersLib.buildProviders as any)()
          .setTarget(targets.NATIVE)
          .setFetcher(standardFetcher)
          .setProxiedFetcher(proxyFetcher)
          .addBuiltinProviders()
          .build();
      } else {
        console.log('[PROVIDER-SOURCE] buildProviders not available, using makeProviders...');

        // Fallback: use makeProviders
        const { makeProviders } = providersLib;
        providersInstance = (makeProviders as any)({
          fetcher: standardFetcher,
          proxiedFetcher: proxyFetcher,
          target: targets.NATIVE,
        });
      }

      console.log('[PROVIDER-SOURCE] Provider instance created');

      // Test if providers are available by trying to list sources
      try {
        const sources = providersInstance.listSources?.();
        console.log('[PROVIDER-SOURCE] Available sources count:', sources?.length || 0);
        if (sources && sources.length > 0) {
          console.log('[PROVIDER-SOURCE] First 5 sources:', sources.slice(0, 5).map((s: any) => s.id));
        }
      } catch (e) {
        console.log('[PROVIDER-SOURCE] Could not list sources (method may not exist)');
      }

      console.log('[PROVIDER-SOURCE] Provider instance initialized successfully');
      return providersInstance;
    } catch (error: any) {
      console.error('[PROVIDER-SOURCE] CRITICAL INITIALIZATION ERROR:', error.message);
      console.error('[PROVIDER-SOURCE] Stack:', error.stack);

      // Log all available exports to help debug
      console.log('[PROVIDER-SOURCE] Available exports from @movie-web/providers:');
      console.log('[PROVIDER-SOURCE]', Object.keys(providersLib).slice(0, 20));

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
