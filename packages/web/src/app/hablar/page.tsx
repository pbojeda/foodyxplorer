import type { Metadata } from 'next';
import { HablarShell } from '@/components/HablarShell';

export const metadata: Metadata = {
  title: 'Hablar — Asistente nutricional',
  description: 'Consulta calorías y macros de platos al instante.',
};

export default function HablarPage() {
  return <HablarShell />;
}
