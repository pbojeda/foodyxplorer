import { Suspense } from 'react';
import type { Metadata } from 'next';
import { HablarShell } from '@/components/HablarShell';
import { HablarAnalytics } from '@/components/HablarAnalytics';

export const metadata: Metadata = {
  title: 'Hablar — Asistente nutricional',
  description: 'Consulta calorías y macros de platos al instante.',
};

export default function HablarPage() {
  return (
    <>
      {/* HablarAnalytics uses useSearchParams — requires Suspense boundary */}
      <Suspense fallback={null}>
        <HablarAnalytics />
      </Suspense>
      <HablarShell />
    </>
  );
}
