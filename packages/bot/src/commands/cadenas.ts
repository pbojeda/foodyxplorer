// /cadenas command handler.

import type { ApiClient } from '../apiClient.js';
import { handleApiError } from './errorMessages.js';
import { formatChainList } from '../formatters/chainFormatter.js';
import { logger } from '../logger.js';

/**
 * List all active chains.
 */
export async function handleCadenas(apiClient: ApiClient): Promise<string> {
  try {
    const chains = await apiClient.listChains();
    return formatChainList(chains);
  } catch (err) {
    logger.warn({ err }, '/cadenas API error');
    return handleApiError(err);
  }
}
