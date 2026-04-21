// Tests for useVoiceSession hook — F091
// Uses renderHook + jest fake timers.
// MediaRecorder, AudioContext, getUserMedia are mocked in jest.setup.ts.

import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceSession } from '@/hooks/useVoiceSession';

jest.mock('@/lib/apiClient', () => ({
  sendVoiceMessage: jest.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    status: number | undefined;
    details: Record<string, unknown> | undefined;
    constructor(message: string, code: string, status?: number, details?: Record<string, unknown>) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
}));

import { sendVoiceMessage } from '@/lib/apiClient';
const mockSendVoiceMessage = sendVoiceMessage as jest.Mock;

const ACTOR_ID = '00000000-0000-4000-a000-000000000099';

// Helper to create a fake MediaStream
function createFakeStream(): MediaStream {
  return {
    getTracks: jest.fn(() => [{ stop: jest.fn(), kind: 'audio' }]),
    getAudioTracks: jest.fn(() => [{ stop: jest.fn(), kind: 'audio' }]),
    active: true,
  } as unknown as MediaStream;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();

  // Reset getUserMedia to resolve successfully by default
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: jest.fn(() => Promise.resolve(createFakeStream())),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// MIME auto-detection
// ---------------------------------------------------------------------------

describe('useVoiceSession — MIME detection', () => {
  it('uses audio/webm;codecs=opus when isTypeSupported returns true', () => {
    // Default mock: isTypeSupported('audio/webm;codecs=opus') = true
    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));
    expect(result.current.mimeType).toBe('audio/webm;codecs=opus');
  });

  it('falls back to audio/mp4 when webm is not supported', () => {
    // Override isTypeSupported for this test
    const original = MediaRecorder.isTypeSupported;
    MediaRecorder.isTypeSupported = jest.fn((mimeType: string) => mimeType === 'audio/mp4');

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));
    expect(result.current.mimeType).toBe('audio/mp4');

    MediaRecorder.isTypeSupported = original;
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe('useVoiceSession — state transitions', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));
    expect(result.current.state).toBe('idle');
  });

  it('start() transitions state idle -> recording', async () => {
    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('recording');
  });

  it('stop() transitions state recording -> uploading', async () => {
    // Block the upload from completing so we can assert 'uploading' state
    let resolveUpload!: (val: unknown) => void;
    mockSendVoiceMessage.mockReturnValueOnce(
      new Promise((resolve) => { resolveUpload = resolve; })
    );

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    act(() => {
      result.current.stop();
    });

    // Should immediately enter uploading (before the async upload resolves)
    expect(result.current.state).toBe('uploading');

    // Cleanup: resolve the upload to avoid hanging
    await act(async () => {
      resolveUpload({ success: true, data: { intent: 'estimation', actorId: ACTOR_ID, activeContext: null } });
      await Promise.resolve();
    });
  });

  it('state becomes done after successful upload', async () => {
    const fakeResponse = {
      success: true,
      data: { intent: 'estimation', actorId: ACTOR_ID, activeContext: null },
    };
    mockSendVoiceMessage.mockResolvedValueOnce(fakeResponse);

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    await waitFor(() => {
      expect(result.current.state).toBe('done');
    });

    expect(result.current.lastResponse).toEqual(fakeResponse);
  });

  it('state becomes error after API error', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/apiClient');
    mockSendVoiceMessage.mockRejectedValueOnce(
      new MockApiError('Whisper failed', 'TRANSCRIPTION_FAILED', 422)
    );

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    // Hook maps TRANSCRIPTION_FAILED -> 'whisper_failure' VoiceErrorCode
    expect(result.current.error?.code).toBe('whisper_failure');
  });

  it('cancel() transitions to idle without making API call', async () => {
    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toBe('idle');
    expect(mockSendVoiceMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// StrictMode duplicate-start guard
// ---------------------------------------------------------------------------

describe('useVoiceSession — StrictMode guard', () => {
  it('calling start() twice without stop() is a no-op on the second call', async () => {
    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    // Second start() should be ignored (already recording)
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    // getUserMedia should only have been called once
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Silence detection
// ---------------------------------------------------------------------------

describe('useVoiceSession — silence detection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('auto-stops after 2000ms of silence (RMS < 0.01)', async () => {
    mockSendVoiceMessage.mockResolvedValueOnce({
      success: true,
      data: { intent: 'estimation', actorId: ACTOR_ID, activeContext: null },
    });

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    // Advance time 2100ms — silence detection should trigger auto-stop
    await act(async () => {
      jest.advanceTimersByTime(2100);
      // Flush microtasks from uploadBlob async chain
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should have transitioned to uploading or beyond
    expect(['uploading', 'done', 'error']).toContain(result.current.state);
  });
});

// ---------------------------------------------------------------------------
// 120s max duration
// ---------------------------------------------------------------------------

describe('useVoiceSession — max duration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('auto-stops after 120000ms max duration', async () => {
    mockSendVoiceMessage.mockResolvedValueOnce({
      success: true,
      data: { intent: 'estimation', actorId: ACTOR_ID, activeContext: null },
    });

    // Override silence detection to NOT trigger (non-silence data)
    const { AudioContext: MockAudioContextClass } = globalThis as unknown as {
      AudioContext: new () => {
        createAnalyser: () => {
          fftSize: number;
          frequencyBinCount: number;
          smoothingTimeConstant: number;
          getByteTimeDomainData: jest.Mock;
          connect: jest.Mock;
          disconnect: jest.Mock;
        };
        createMediaStreamSource: () => { connect: jest.Mock };
        close: jest.Mock;
      };
    };

    const origCreate = MockAudioContextClass.prototype.createAnalyser;
    // @ts-expect-error mock override
    MockAudioContextClass.prototype.createAnalyser = jest.fn(() => ({
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.8,
      getByteTimeDomainData: jest.fn((array: Uint8Array) => {
        // Loud signal — RMS > 0.01, silence never detected
        for (let i = 0; i < array.length; i++) {
          array[i] = 200; // above 128 midpoint = loud
        }
      }),
      connect: jest.fn(),
      disconnect: jest.fn(),
    }));

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    // Advance past 120s
    await act(async () => {
      jest.advanceTimersByTime(120001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(['uploading', 'done', 'error']).toContain(result.current.state);

    // @ts-expect-error restore
    MockAudioContextClass.prototype.createAnalyser = origCreate;
  });
});

// ---------------------------------------------------------------------------
// Retained Blob for retry
// ---------------------------------------------------------------------------

describe('useVoiceSession — retry with retained Blob', () => {
  it('retains Blob after error and re-submits on retry()', async () => {
    const { ApiError: MockApiError } = jest.requireMock('@/lib/apiClient');

    // First upload fails
    mockSendVoiceMessage.mockRejectedValueOnce(
      new MockApiError('Network error', 'NETWORK_ERROR')
    );
    // Second upload (retry) succeeds
    mockSendVoiceMessage.mockResolvedValueOnce({
      success: true,
      data: { intent: 'estimation', actorId: ACTOR_ID, activeContext: null },
    });

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
    // Hook maps NETWORK_ERROR -> 'network' VoiceErrorCode
    expect(result.current.error?.code).toBe('network');

    // Retry should re-submit retained Blob without re-recording
    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state).toBe('done');
    });

    // sendVoiceMessage called twice (original + retry)
    expect(mockSendVoiceMessage).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// MicPermission denied
// ---------------------------------------------------------------------------

describe('useVoiceSession — mic permission denied', () => {
  it('transitions to error with code mic_permission when getUserMedia throws NotAllowedError', async () => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: jest.fn().mockRejectedValueOnce(
          Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
        ),
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVoiceSession(ACTOR_ID));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('mic_permission');
  });
});
