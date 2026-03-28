// Context formatter — MarkdownV2 strings for /contexto command responses.

import type { BotStateChainContext } from '../lib/conversationState.js';
import { escapeMarkdown } from './markdownUtils.js';

/**
 * Confirmation message shown after successfully setting chain context.
 */
export function formatContextConfirmation(chainName: string, chainSlug: string): string {
  const escapedName = escapeMarkdown(chainName);
  // chainSlug goes inside a code span — backtick is the delimiter, not content
  return (
    `Contexto establecido: *${escapedName}* \`${chainSlug}\`\\.\n` +
    `Las próximas consultas de /estimar y /comparar se filtrarán por esta cadena\\.`
  );
}

/**
 * View message shown when the user has an active chain context.
 * remainingSeconds: TTL from Redis. Shows expiry time when > 0, "Expira pronto" otherwise.
 */
export function formatContextView(
  chainContext: BotStateChainContext,
  remainingSeconds: number,
): string {
  const escapedName = escapeMarkdown(chainContext.chainName);
  // chainSlug goes inside a code span — no escaping needed for the content
  const header = `Contexto activo: *${escapedName}* \`${chainContext.chainSlug}\``;

  if (remainingSeconds > 0) {
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    return `${header}\nExpira en aproximadamente *${hours}h ${minutes}m*\\.`;
  }

  return `${header}\nExpira pronto\\.`;
}

/**
 * Message shown after clearing (or when clearing already-absent) chain context.
 */
export function formatContextCleared(): string {
  return `Contexto borrado\\. Las siguientes consultas no estarán filtradas por cadena\\.`;
}
