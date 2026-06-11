// F-ADMIN-ANALYTICS-UI — Phase F-A: useT hook unit tests.
// AC22: useT('admin') resolves dot-separated keys, falls back to key string.

import { renderHook } from '@testing-library/react';
import { useT } from '../../lib/i18n/useT';

/** Helper: get the t function from a renderHook call */
function getT(namespace: string): (key: string) => string {
  return renderHook(() => useT(namespace)).result.current;
}

describe('useT', () => {
  describe('admin namespace', () => {
    it('resolves a top-level nested key (layout.loading)', () => {
      const t = getT('admin');
      expect(t('layout.loading')).toBe('Verificando acceso...');
    });

    it('resolves a deep nested key (panel.missedQueries.title)', () => {
      const t = getT('admin');
      expect(t('panel.missedQueries.title')).toBe('Búsquedas sin respuesta');
    });

    it('resolves a 3-level nested key (layout.403.forbidden.title)', () => {
      const t = getT('admin');
      expect(t('layout.403.forbidden.title')).toBe('Acceso denegado');
    });

    it('resolves intent flat key (intent.estimation)', () => {
      const t = getT('admin');
      expect(t('intent.estimation')).toBe('Estimación');
    });

    it('falls back to key string for missing key (nonexistent.key)', () => {
      const t = getT('admin');
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('falls back to key string when intermediate node is not object', () => {
      const t = getT('admin');
      // 'layout.loading' is a string, not an object, so 'layout.loading.deep' should fallback
      expect(t('layout.loading.deep')).toBe('layout.loading.deep');
    });

    it('returns the key when value is not a string (resolves to object node)', () => {
      const t = getT('admin');
      // 'layout' resolves to an object — not a string — should return key
      expect(t('layout')).toBe('layout');
    });

    it('resolves panel.responseReview.summary', () => {
      const t = getT('admin');
      expect(t('panel.responseReview.summary')).toBe(
        'Últimas {count} entradas en las últimas {hours} horas'
      );
    });

    it('resolves common.badge.pending', () => {
      const t = getT('admin');
      expect(t('common.badge.pending')).toBe('Investigando');
    });

    it('resolves layout.403.notProvisioned.hint', () => {
      const t = getT('admin');
      expect(t('layout.403.notProvisioned.hint')).toBe(
        'Llama a /me primero para activar tu cuenta y vuelve a intentarlo.'
      );
    });
  });

  describe('unknown namespace', () => {
    it('returns the key string itself for any key', () => {
      const t = getT('unknown-namespace');
      expect(t('any.key')).toBe('any.key');
    });

    it('returns empty key as-is', () => {
      const t = getT('nonexistent');
      expect(t('')).toBe('');
    });
  });

  describe('referential stability (I4)', () => {
    it('returns the same t reference on re-render with same namespace', () => {
      const { result, rerender } = renderHook(() => useT('admin'));
      const firstRef = result.current;
      rerender();
      rerender();
      expect(result.current).toBe(firstRef);
    });

    it('returns a different t reference when namespace changes', () => {
      const { result, rerender } = renderHook(({ ns }: { ns: string }) => useT(ns), {
        initialProps: { ns: 'admin' },
      });
      const firstRef = result.current;
      rerender({ ns: 'other' });
      expect(result.current).not.toBe(firstRef);
    });
  });
});
