/**
 * Wrapper for provider-source imports
 * This file helps TypeScript resolve imports from the external provider-source directory
 */

// Re-export everything from provider-source for easier importing
// @ts-ignore - provider-source is external TypeScript source without compiled output
export * from '../../provider-source/index';
