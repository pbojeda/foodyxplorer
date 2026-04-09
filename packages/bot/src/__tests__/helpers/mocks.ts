// Shared test helpers for mock introspection (bot package).
//
// See BUG-DEV-LINT-001 (F115) for why this exists: the strict ESLint preset
// `tseslint.configs.strict` enforces `@typescript-eslint/no-non-null-assertion`,
// and `noUncheckedIndexedAccess` makes `someMock.mock.calls[0]![0]` the only
// way to access a mock's first call argument without a verbose guard. That
// pattern was used in 13 places across the bot tests. This helper replaces
// it with a clearly-typed function that throws a diagnostic error if the
// mock wasn't called, instead of letting an `as` cast silently lie.

/**
 * Minimal structural type of a vitest/jest mock function. Kept duck-typed so
 * the helper works with `ReturnType<typeof vi.fn>`, `Mock<T>`,
 * `MockInstance<T>`, or any other mock shape that exposes `mock.calls`.
 */
interface MockLike {
  mock: { calls: unknown[][] };
}

/**
 * Returns the first argument of the first call to a mock.
 *
 * Throws a clear diagnostic error if the mock has not been called yet,
 * instead of letting a silent `undefined` propagate downstream and cause
 * confusing errors far from the real problem.
 *
 * @param mock - A vitest/jest mock (anything with `mock.calls: unknown[][]`)
 * @returns The first argument from the first recorded call, cast to `T`
 * @throws Error if the mock's call history is empty
 *
 * @example
 * ```ts
 * await client.estimate({ query: 'big mac', portionMultiplier: 1.5 });
 * const url = new URL(firstCallArg<string>(fetchMock));
 * expect(url.searchParams.get('portionMultiplier')).toBe('1.5');
 * ```
 */
export function firstCallArg<T>(mock: MockLike): T {
  const [firstCall] = mock.mock.calls;
  if (!firstCall) {
    throw new Error('Expected mock to have been called at least once');
  }
  return firstCall[0] as T;
}
