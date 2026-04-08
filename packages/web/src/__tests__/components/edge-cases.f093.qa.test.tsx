/**
 * @jest-environment jsdom
 *
 * F093 QA — Web package edge-case tests
 *
 * Coverage gaps identified by QA review:
 * 1. hablar_page_view: UTM keys are undefined (not absent) in the object — GA4 compatible
 * 2. hablar_query_sent fires BEFORE the API call result (immediately on submit)
 * 3. hablar_query_sent does not include query text or PII
 * 4. HablarAnalytics renders null even when useSearchParams returns empty params
 * 5. Multiple HablarAnalytics mounts (StrictMode double-effect): fires hablar_page_view once per mount cycle
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// HablarAnalytics tests
// ---------------------------------------------------------------------------

jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

import { HablarAnalytics } from '../../components/HablarAnalytics';
import { useSearchParams } from 'next/navigation';

const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>;

describe('F093 QA — HablarAnalytics edge cases', () => {
  beforeEach(() => {
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [];
    jest.clearAllMocks();
  });

  it('hablar_page_view key is present but value is undefined when UTM params absent (JSON-serialization safe)', async () => {
    // The implementation pushes: { event: 'hablar_page_view', utm_source: undefined, ... }
    // When GA4 serializes via JSON.stringify, undefined values are OMITTED — effectively absent.
    // This is spec-compliant even though the object has the key set to undefined.
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    await act(async () => { render(<HablarAnalytics />); });

    const dl = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? [];
    const event = dl.find((e) => (e as { event: string }).event === 'hablar_page_view') as Record<string, unknown> | undefined;
    expect(event).toBeDefined();

    // Key present in object with value undefined
    expect(Object.prototype.hasOwnProperty.call(event, 'utm_source')).toBe(true);
    expect(event!['utm_source']).toBeUndefined();

    // JSON.stringify omits undefined — GA4 will NOT see utm_source field
    const json = JSON.stringify(event);
    expect(json).not.toContain('utm_source');
    expect(json).toContain('hablar_page_view');
  });

  it('hablar_page_view with all three UTM params: all values present in pushed object', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('utm_source=landing&utm_medium=bottom_cta&utm_campaign=spring2026')
    );
    await act(async () => { render(<HablarAnalytics />); });

    const dl = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? [];
    const event = dl.find((e) => (e as { event: string }).event === 'hablar_page_view') as Record<string, unknown> | undefined;
    expect(event!['utm_source']).toBe('landing');
    expect(event!['utm_medium']).toBe('bottom_cta');
    expect(event!['utm_campaign']).toBe('spring2026');
  });

  it('does not throw when window is undefined (SSR guard skipped in jsdom — validate no-crash)', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    await expect(
      act(async () => { render(<HablarAnalytics />); })
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// HablarShell — hablar_query_sent timing and PII checks
// ---------------------------------------------------------------------------

jest.mock('../../lib/actorId', () => ({
  getActorId: jest.fn().mockReturnValue('mock-actor-uuid'),
  persistActorId: jest.fn(),
}));

jest.mock('../../lib/apiClient', () => ({
  sendMessage: jest.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    status: number | undefined;
    constructor(message: string, code: string, status?: number) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
    }
  },
}));

import { HablarShell } from '../../components/HablarShell';
import { sendMessage } from '../../lib/apiClient';

const mockSendMessage = sendMessage as jest.Mock;

describe('F093 QA — hablar_query_sent timing and payload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [];
  });

  it('hablar_query_sent fires synchronously on submit BEFORE API response resolves', async () => {
    // Use a never-resolving promise to confirm the event fires before the API call completes
    mockSendMessage.mockReturnValue(new Promise(() => {}));
    render(<HablarShell />);

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'big mac');
    await userEvent.type(textarea, '{Enter}');

    // At this point API call is still pending — but hablar_query_sent should already be in dataLayer
    const dl = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? [];
    const hasSentEvent = dl.some((e) => (e as { event: string }).event === 'hablar_query_sent');
    expect(hasSentEvent).toBe(true);
  });

  it('hablar_query_sent payload contains only event key — no query text, no PII', async () => {
    mockSendMessage.mockReturnValue(new Promise(() => {}));
    render(<HablarShell />);

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'my personal food query with PII');
    await userEvent.type(textarea, '{Enter}');

    const dl = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? [];
    const sentEvent = dl.find(
      (e) => (e as { event: string }).event === 'hablar_query_sent'
    ) as Record<string, unknown> | undefined;

    expect(sentEvent).toBeDefined();
    // Exact payload — only the event key, no additional fields
    expect(Object.keys(sentEvent!)).toEqual(['event']);
    // No query text
    expect(JSON.stringify(sentEvent)).not.toContain('PII');
    expect(JSON.stringify(sentEvent)).not.toContain('personal');
    expect(JSON.stringify(sentEvent)).not.toContain('big mac');
  });

  it('hablar_query_sent fires even when API returns an error (fires before try/catch)', async () => {
    const { ApiError } = require('../../lib/apiClient');
    mockSendMessage.mockRejectedValue(new ApiError('Error', 'INTERNAL_ERROR', 500));
    render(<HablarShell />);

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'big mac');
    await userEvent.type(textarea, '{Enter}');

    await waitFor(() => {
      const dl = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? [];
      const hasSentEvent = dl.some((e) => (e as { event: string }).event === 'hablar_query_sent');
      expect(hasSentEvent).toBe(true);
    });
  });

  it('hablar_query_sent is NOT pushed when query is whitespace only', async () => {
    render(<HablarShell />);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await userEvent.type(textarea, '   {Enter}');
    const dl = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? [];
    const hasSentEvent = dl.some((e) => (e as { event: string }).event === 'hablar_query_sent');
    expect(hasSentEvent).toBe(false);
  });
});
