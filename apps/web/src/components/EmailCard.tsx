import { motion, useReducedMotion } from 'framer-motion';
import type { EmailWithClassification } from '@inbox-concierge/shared';

interface EmailCardProps {
  email: EmailWithClassification;
  bucketColor: string | null;
}

/**
 * Sender, subject, snippet, and a colored bucket tag — the spec's "homepage of any email
 * application" card, no click-through. `title` gives the justification a free native tooltip;
 * a richer hover/click interaction is Phase 5 polish, not needed to satisfy the spec here.
 * `layoutId` lets Framer Motion animate this card smoothly as it moves from the "Unsorted"
 * column into its real bucket column while classification streams in. When the user prefers
 * reduced motion, `layout` (position) still animates minimally, but the opacity/slide entrance
 * is skipped — this is the animation-heaviest phase, so the pre-existing gap gets fixed here.
 */
export function EmailCard({ email, bucketColor }: EmailCardProps) {
  const isUnclassified = email.status === 'unclassified';
  const reduceMotion = useReducedMotion();

  return (
    <motion.article
      layout
      layoutId={email.emailId}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
      className="rounded-lg border border-slate-800 bg-slate-900 p-3 shadow-sm"
      title={email.justification ?? undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-100">{email.subject || '(no subject)'}</p>
        {bucketColor && (
          <span
            className="mt-1 h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: bucketColor }}
            aria-hidden="true"
          />
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-400">{email.fromAddress || 'Unknown sender'}</p>
      {email.snippet && <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{email.snippet}</p>}
      {isUnclassified && <p className="mt-1.5 text-xs font-medium text-amber-400">Couldn&rsquo;t be classified</p>}
    </motion.article>
  );
}
