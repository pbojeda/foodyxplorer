import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { SectionObserver } from '@/components/analytics/SectionObserver';
import * as analytics from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  getUtmParams: jest.fn(() => ({})),
}));

const mockTrackEvent = analytics.trackEvent as jest.MockedFunction<
  typeof analytics.trackEvent
>;

describe('SectionObserver', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  it('calls trackEvent with section_view when IntersectionObserver triggers', async () => {
    render(
      <SectionObserver sectionId="hero" variant="a">
        <div>Hero content</div>
      </SectionObserver>
    );

    // IntersectionObserver mock calls callback after setTimeout(0)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'section_view',
        section: 'hero',
        variant: 'a',
        lang: 'es',
      })
    );
  });

  it('does not call trackEvent a second time (fires once and disconnects)', async () => {
    render(
      <SectionObserver sectionId="problem" variant="b">
        <div>Problem content</div>
      </SectionObserver>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Trigger again — should not fire again since observer disconnects
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const calls = mockTrackEvent.mock.calls.filter(
      ([payload]) => payload.event === 'section_view' && payload['section'] === 'problem'
    );
    expect(calls).toHaveLength(1);
  });

  it('renders children inside a div wrapper', () => {
    const { getByText } = render(
      <SectionObserver sectionId="hero" variant="a">
        <div>My child content</div>
      </SectionObserver>
    );
    expect(getByText('My child content')).toBeInTheDocument();
  });
});
