'use client';

// useAuth — F107a (ADR-025 R3 §6)
// Consumes AuthContext provided by AuthProvider.
// Throws a descriptive error if used outside of AuthProvider.

import { useContext } from 'react';
import { AuthContext } from '@/components/AuthProvider';
import type { AuthContextValue } from '@/components/AuthProvider';

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error(
      'useAuth must be used inside an <AuthProvider>. ' +
        'Wrap your component tree with <AuthProvider> in layout.tsx.'
    );
  }
  return context;
}
