// /contexto command handler — manage per-chat chain context.

import type { Redis } from 'ioredis';
import type { ApiClient } from '../apiClient.js';
import { ApiError } from '../apiClient.js';
import { getState, setState, setStateStrict, stateKey } from '../lib/conversationState.js';
import { resolveChain } from '../lib/chainResolver.js';
import {
  formatContextConfirmation,
  formatContextView,
  formatContextCleared,
} from '../formatters/contextFormatter.js';

/**
 * Handle /contexto command.
 *
 * - Empty args   → View flow (show active context or prompt to set one)
 * - "borrar"     → Clear flow (remove chainContext from state)
 * - Anything else → Set flow (resolve chain and persist context)
 */
export async function handleContexto(
  args: string,
  chatId: number,
  redis: Redis,
  apiClient: ApiClient,
): Promise<string> {
  const trimmed = args.trim();

  // -------------------------------------------------------------------------
  // View flow
  // -------------------------------------------------------------------------

  if (trimmed === '') {
    const state = await getState(redis, chatId);
    if (!state?.chainContext) {
      return 'No hay contexto activo\\. Usa /contexto \\<cadena\\> para establecerlo\\.';
    }

    let remainingSeconds = -1;
    try {
      remainingSeconds = await redis.ttl(stateKey(chatId));
    } catch {
      // Fail-open: TTL error → default to -1 → "Expira pronto"
    }

    return formatContextView(state.chainContext, remainingSeconds);
  }

  // -------------------------------------------------------------------------
  // Clear flow
  // -------------------------------------------------------------------------

  if (trimmed === 'borrar') {
    const state = await getState(redis, chatId);
    if (!state?.chainContext) {
      return formatContextCleared();
    }

    delete state.chainContext;
    await setState(redis, chatId, state);
    return formatContextCleared();
  }

  // -------------------------------------------------------------------------
  // Set flow
  // -------------------------------------------------------------------------

  let resolved;
  try {
    resolved = await resolveChain(trimmed, apiClient);
  } catch (err) {
    if (err instanceof ApiError) {
      return 'No pude comprobar las cadenas ahora mismo\\. Inténtalo de nuevo\\.';
    }
    throw err;
  }

  if (resolved === null) {
    return 'No encontré ninguna cadena con ese nombre\\. Usa /cadenas para ver las cadenas disponibles\\.';
  }

  if (resolved === 'ambiguous') {
    return 'Encontré varias cadenas con ese nombre\\. Por favor, usa el slug exacto \\(por ejemplo: mcdonalds\\-es\\)\\. Usa /cadenas para ver los slugs\\.';
  }

  // Persist chain context — fail-open on Redis read, strict on write
  const state = (await getState(redis, chatId)) ?? {};
  state.chainContext = {
    chainSlug: resolved.chainSlug,
    chainName: resolved.chainName,
  };

  const saved = await setStateStrict(redis, chatId, state);
  if (!saved) {
    return 'No pude guardar el contexto\\. Inténtalo de nuevo\\.';
  }

  return formatContextConfirmation(resolved.chainName, resolved.chainSlug);
}
