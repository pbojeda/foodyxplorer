// React hook that exposes live metrics via useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import { subscribe, getMetrics, type MetricsSnapshot } from '@/lib/metrics';

export function useMetrics(): MetricsSnapshot {
  return useSyncExternalStore(subscribe, getMetrics, getMetrics);
}
