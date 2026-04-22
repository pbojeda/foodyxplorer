'use client';

// VoiceBudgetBadge — 8px amber dot shown on MicButton when monthly voice budget is active.
// Pure presentational — no internal state.

export function VoiceBudgetBadge() {
  return (
    <span
      data-testid="voice-budget-badge"
      aria-hidden="true"
      className="absolute right-0 top-0 h-2 w-2 rounded-full bg-amber-400"
    />
  );
}
