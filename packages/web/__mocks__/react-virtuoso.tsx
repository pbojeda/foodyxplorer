// Manual mock for react-virtuoso — used globally in all test suites.
// Replaces Virtuoso's virtualization engine (which needs real DOM layout) with a
// passthrough that renders all items synchronously in jsdom.
//
// VirtuosoHandle (ref) methods are stubbed as jest.fn() so tests can assert on them.
// The mock renders:
//   1. components.Header (if provided) with the context prop
//   2. All items via itemContent
//
// Tests that need to capture props can use jest.mock('react-virtuoso') in their file
// to override this manual mock with a spy version (TranscriptFeed.test.tsx pattern).

import React from 'react';

const Virtuoso = React.forwardRef(function Virtuoso(
  props: Record<string, unknown>,
  ref: React.Ref<unknown>
) {
  // Expose imperative handle stubs
  React.useImperativeHandle(ref, () => ({
    scrollToIndex: jest.fn(),
    scrollTo: jest.fn(),
    scrollBy: jest.fn(),
    autoscrollToBottom: jest.fn(),
    getState: jest.fn(),
  }));

  const data = props['data'] as Array<Record<string, unknown>> | undefined;
  const itemContent = props['itemContent'] as
    | ((idx: number, item: Record<string, unknown>) => React.ReactNode)
    | undefined;
  const components = props['components'] as
    | { Header?: React.ComponentType<{ context?: unknown }> }
    | undefined;
  const context = props['context'];
  const HeaderComp = components?.Header;

  const ariaBusy = props['aria-busy'] as string | boolean | undefined;

  return (
    <div
      role={props['role'] as string | undefined}
      aria-label={props['aria-label'] as string | undefined}
      aria-busy={ariaBusy === 'true' ? true : ariaBusy === 'false' ? false : ariaBusy as boolean | undefined}
      data-testid="virtuoso-root"
      className={props['className'] as string | undefined}
    >
      {HeaderComp && <HeaderComp context={context} />}
      {data?.map((item, idx) =>
        itemContent ? (
          <React.Fragment key={String(item['entryId'] ?? idx)}>
            {itemContent(idx, item)}
          </React.Fragment>
        ) : null
      )}
    </div>
  );
});

module.exports = { Virtuoso };
