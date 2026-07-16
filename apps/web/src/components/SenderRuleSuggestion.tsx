import type { SenderRuleSuggestion as Suggestion } from '@inbox-concierge/shared';

/**
 * Shown once repeated manual corrections cross the backend's threshold (build guide §5.7's
 * feedback-loop framing) — "you keep doing this, want it automatic?" Accept persists the rule and
 * applies it to every already-synced email from that sender immediately; Dismiss is client-side
 * only (no "don't ask again" persistence) — deliberately simple, and it'll resurface next load if
 * still true, which is an acceptable tradeoff for how small this signal is.
 */
export function SenderRuleSuggestionBanner({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm">
      <p className="text-slate-200">
        You&rsquo;ve moved {suggestion.correctionCount} emails from <span className="font-medium">{suggestion.fromAddress}</span> to{' '}
        <span className="font-medium">{suggestion.bucketName}</span> — always do this?
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onAccept}
          className="rounded-md bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          Always do this
        </button>
        <button
          onClick={onDismiss}
          className="rounded-md px-3 py-1 text-xs text-slate-400 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
