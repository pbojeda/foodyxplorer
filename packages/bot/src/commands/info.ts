// /info command handler.

import type { ApiClient } from '../apiClient.js';
import type { BotConfig } from '../config.js';
import { escapeMarkdown } from '../formatters/markdownUtils.js';

/**
 * Show bot version and live API health check.
 * Tolerates healthCheck failure — never throws, never crashes.
 */
export async function handleInfo(config: BotConfig, apiClient: ApiClient): Promise<string> {
  let apiStatus: string;

  try {
    const isHealthy = await apiClient.healthCheck();
    apiStatus = isHealthy ? 'conectada ✅' : 'Sin conexion ❌';
  } catch {
    apiStatus = 'Sin conexion ❌';
  }

  return [
    `*foodXPlorer Bot* v${escapeMarkdown(config.BOT_VERSION)}`,
    '',
    `API: ${apiStatus}`,
  ].join('\n');
}
