/**
 * Global type augmentations for the web package.
 * Extends the Window interface with browser globals used in this app.
 */

declare global {
  interface Window {
    /**
     * GA4 dataLayer queue. Events pushed here are replayed by gtag.js once it loads.
     * Pattern: (window.dataLayer = window.dataLayer || []).push(...)
     */
    dataLayer?: Record<string, unknown>[];
  }
}

export {};
