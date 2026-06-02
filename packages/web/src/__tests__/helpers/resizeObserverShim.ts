/**
 * resizeObserverShim.ts
 *
 * Controllable ResizeObserver shim for unit tests. Designed to coexist with the
 * no-op MockResizeObserver installed in jest.setup.ts (that stub is installed
 * conditionally — `install()` overrides globalThis.ResizeObserver for a targeted
 * test; `uninstall()` restores whatever was there before, typically the no-op stub).
 *
 * Usage:
 *   const shim = createResizeObserverShim();
 *   beforeEach(() => shim.install());
 *   afterEach(() => { shim.uninstall(); jest.useRealTimers(); });
 *
 *   // After component renders and fires new ResizeObserver(cb):
 *   shim.fire([{ target: feed, ... } as ResizeObserverEntry]);
 */

export interface ShimObserverInstance {
  observe: jest.Mock;
  unobserve: jest.Mock;
  disconnect: jest.Mock;
  cb: ResizeObserverCallback;
}

export interface ResizeObserverShim {
  /** Install: replace globalThis.ResizeObserver with the controllable shim. */
  install(): void;
  /** Uninstall: restore whatever globalThis.ResizeObserver was before install(). */
  uninstall(): void;
  /**
   * The callback passed to the last `new ResizeObserver(cb)` call.
   * null until install() has been called and a component has constructed an observer.
   */
  lastObserverCb: ResizeObserverCallback | null;
  /**
   * The last ShimObserverInstance created by `new ResizeObserver(...)`.
   * Exposes per-instance disconnect/observe mocks for fine-grained assertions (AC13).
   */
  lastObserver: ShimObserverInstance | null;
  /**
   * Aggregate mock incremented every time ANY shim instance calls disconnect().
   * Useful for "disconnect was called N times total" assertions across multiple instances.
   */
  disconnectMock: jest.Mock;
  /**
   * Aggregate mock incremented every time ANY shim instance calls observe().
   */
  observeMock: jest.Mock;
  /**
   * Synchronously invoke lastObserverCb with the given entries.
   * Throws if lastObserverCb is null (shim not installed or no observer constructed yet).
   */
  fire(entries?: Partial<ResizeObserverEntry>[], observer?: ResizeObserver): void;
  /**
   * Null out lastObserverCb and lastObserver WITHOUT restoring the global.
   * Also resets disconnectMock + observeMock. Use in beforeEach inside a describe
   * block that calls install() once in a parent beforeAll.
   */
  reset(): void;
}

export function createResizeObserverShim(): ResizeObserverShim {
  let _prior: typeof ResizeObserver | undefined = undefined;
  // BUG-SHIM-UNINSTALL-001 (qa-engineer 2026-06-02): track whether install() actually
  // ran, so uninstall() called in isolation (e.g., a test that calls uninstall in
  // afterEach without install in beforeEach due to a refactor) does NOT silently
  // assign globalThis.ResizeObserver = undefined and wipe the jest.setup.ts stub.
  let _installed = false;

  const shim: ResizeObserverShim = {
    lastObserverCb: null,
    lastObserver: null,
    disconnectMock: jest.fn(),
    observeMock: jest.fn(),

    install() {
      _prior = globalThis.ResizeObserver;
      _installed = true;

      const disconnectMock = shim.disconnectMock;
      const observeMock = shim.observeMock;

      class ShimResizeObserver {
        observe: jest.Mock;
        unobserve: jest.Mock;
        disconnect: jest.Mock;
        cb: ResizeObserverCallback;

        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;

          this.observe = jest.fn((...args: Parameters<ResizeObserver['observe']>) => {
            observeMock(...args);
          });
          this.unobserve = jest.fn();
          this.disconnect = jest.fn(() => {
            disconnectMock();
          });

          const instance: ShimObserverInstance = {
            observe: this.observe,
            unobserve: this.unobserve,
            disconnect: this.disconnect,
            cb,
          };

          shim.lastObserver = instance;
          shim.lastObserverCb = cb;
        }
      }

      // @ts-expect-error — assigning a non-standard shim class
      globalThis.ResizeObserver = ShimResizeObserver;
    },

    uninstall() {
      // BUG-SHIM-UNINSTALL-001 guard: only restore the prior global if install()
      // actually ran. Calling uninstall() in isolation must be a no-op for the
      // global (otherwise the jest.setup.ts no-op ResizeObserver stub gets wiped
      // and downstream tests in the same worker can silently break).
      if (_installed) {
        // @ts-expect-error — restoring prior value which may be undefined (test env)
        globalThis.ResizeObserver = _prior;
        _installed = false;
      }
      shim.lastObserverCb = null;
      shim.lastObserver = null;
      shim.disconnectMock.mockReset();
      shim.observeMock.mockReset();
    },

    fire(entries?: Partial<ResizeObserverEntry>[], observer?: ResizeObserver) {
      if (!shim.lastObserverCb) {
        throw new Error(
          'resizeObserverShim.fire(): lastObserverCb is null — did you call install() and render a component that constructs a ResizeObserver?',
        );
      }
      const resolvedObserver =
        observer ?? (shim.lastObserver as unknown as ResizeObserver);
      shim.lastObserverCb(
        (entries ?? []) as ResizeObserverEntry[],
        resolvedObserver,
      );
    },

    reset() {
      shim.lastObserverCb = null;
      shim.lastObserver = null;
      shim.disconnectMock.mockReset();
      shim.observeMock.mockReset();
    },
  };

  return shim;
}
