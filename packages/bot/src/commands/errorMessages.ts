// Shared API error → Spanish user message mapping.
//
// All command handlers use this helper to avoid duplicating the same
// error-to-message logic across 7 files. Technical details are logged
// separately by each handler; this function only returns the user-facing string.

import { ApiError } from '../apiClient.js';
import { logger } from '../logger.js';

/**
 * Map an ApiError (or any unknown error) to a user-friendly Spanish string.
 * All strings are pre-escaped for MarkdownV2.
 */
export function handleApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) {
      return 'Demasiadas consultas\\. Espera un momento\\.';
    }
    if (err.statusCode === 401 || err.statusCode === 403) {
      logger.fatal({ err }, 'Bot API key rejected — check BOT_API_KEY configuration');
      return 'Error de configuracion del bot\\.';
    }
    if (err.statusCode >= 500) {
      return 'El servicio no esta disponible\\.';
    }
    if (err.code === 'TIMEOUT') {
      return 'La consulta tardo demasiado\\.';
    }
    if (err.code === 'NETWORK_ERROR') {
      return 'No se puede conectar con el servidor\\.';
    }
  }
  return 'Ha ocurrido un error inesperado\\.';
}
