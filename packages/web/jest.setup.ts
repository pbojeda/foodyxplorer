import '@testing-library/jest-dom';
import { webcrypto } from 'crypto';

// ---------------------------------------------------------------------------
// F091 Voice: MediaRecorder mock
// ---------------------------------------------------------------------------

class MockMediaRecorder {
  static isTypeSupported(mimeType: string): boolean {
    // Default: webm supported, mp4 not. Individual tests can override.
    return mimeType === 'audio/webm;codecs=opus' || mimeType === 'audio/webm';
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  stream: MediaStream;

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  start(_timeslice?: number) {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['audio-data'], { type: this.mimeType }) });
    }
    if (this.onstop) {
      this.onstop();
    }
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }
}

// @ts-expect-error global mock for test env
globalThis.MediaRecorder = MockMediaRecorder;

// ---------------------------------------------------------------------------
// F091 Voice: SpeechSynthesis mock
// ---------------------------------------------------------------------------

const mockSpeechSynthesisVoices: SpeechSynthesisVoice[] = [];

const mockSpeechSynthesis = {
  speaking: false,
  pending: false,
  paused: false,
  speak: jest.fn(),
  cancel: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  getVoices: jest.fn(() => mockSpeechSynthesisVoices),
  onvoiceschanged: null as ((ev: Event) => void) | null,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
};

Object.defineProperty(globalThis, 'speechSynthesis', {
  value: mockSpeechSynthesis,
  writable: true,
  configurable: true,
});

// SpeechSynthesisUtterance mock
class MockSpeechSynthesisUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  lang = 'es-ES';
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

// @ts-expect-error global mock for test env
globalThis.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

// ---------------------------------------------------------------------------
// F091 Voice: navigator.vibrate mock
// ---------------------------------------------------------------------------

Object.defineProperty(navigator, 'vibrate', {
  value: jest.fn(() => true),
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// F091 Voice: AudioContext / AnalyserNode mock
// ---------------------------------------------------------------------------

class MockAnalyserNode {
  fftSize = 2048;
  frequencyBinCount = 1024;
  smoothingTimeConstant = 0.8;
  getByteTimeDomainData = jest.fn((_array: Uint8Array) => {
    // Default: silence (all 128 = midpoint, RMS ≈ 0)
    _array.fill(128);
  });
  getFloatTimeDomainData = jest.fn((_array: Float32Array) => {
    _array.fill(0);
  });
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockMediaStreamSource {
  connect = jest.fn();
  disconnect = jest.fn();
}

class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  createAnalyser = jest.fn(() => new MockAnalyserNode());
  createMediaStreamSource = jest.fn(() => new MockMediaStreamSource());
  close = jest.fn();
}

// @ts-expect-error global mock for test env
globalThis.AudioContext = MockAudioContext;

// ---------------------------------------------------------------------------
// F091 Voice: getUserMedia mock (returns a fake MediaStream)
// ---------------------------------------------------------------------------

const mockMediaStream = {
  getTracks: jest.fn(() => [{ stop: jest.fn(), kind: 'audio' }]),
  getAudioTracks: jest.fn(() => [{ stop: jest.fn(), kind: 'audio' }]),
  active: true,
};

Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  value: {
    getUserMedia: jest.fn(() => Promise.resolve(mockMediaStream)),
  },
  writable: true,
  configurable: true,
});

// Polyfill Web Fetch API globals for test environment (needed by Route Handler tests).
// In Node.js 20 these are available globally but jsdom may shadow them.
if (typeof globalThis.Request === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Request, Response, Headers, fetch } = require('node-fetch');
  globalThis.Request = Request;
  globalThis.Response = Response;
  globalThis.Headers = Headers;
  globalThis.fetch = fetch;
} else {
  // Node 20+ — ensure the native globals are exposed in jsdom test env
  // (next/jest may clear them; re-assign from global scope)
  if (typeof Request === 'undefined') {
    // @ts-expect-error global assignment for test env
    global.Request = globalThis.Request;
    // @ts-expect-error global assignment for test env
    global.Response = globalThis.Response;
    // @ts-expect-error global assignment for test env
    global.Headers = globalThis.Headers;
  }
}

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
