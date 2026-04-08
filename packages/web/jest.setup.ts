import '@testing-library/jest-dom';
import { webcrypto } from 'crypto';

// Polyfill crypto.randomUUID for jsdom test environment (Node < 19 / jsdom does
// not expose crypto.randomUUID by default).
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
}

// Polyfill AbortSignal.timeout and AbortSignal.any for jsdom test environment.
// These are available in Node 18+ and modern browsers but not always exposed by jsdom.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = function timeout(ms: number): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new DOMException('TimeoutError', 'TimeoutError'));
    }, ms);
    return controller.signal;
  };
}

if (typeof (AbortSignal as unknown as { any?: unknown }).any !== 'function') {
  (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any = function any(
    signals: AbortSignal[]
  ): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  };
}
