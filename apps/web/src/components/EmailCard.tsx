import { motion, useReducedMotion } from 'framer-motion';
import * as Popover from '@radix-ui/react-popover';
import type { EmailWithClassification } from '@inbox-concierge/shared';

interface EmailCardProps {
  email: EmailWithClassification;
  bucketColor: string | null;
}

/**
 * Sender, subject, snippet, and a colored bucket tag — the spec's "homepage of any email
 * application" card, no click-through. `layoutId` lets Framer Motion animate this card smoothly
 * as it moves from the "Unsorted" column into its real bucket column while classification
 * streams in. When the user prefers reduced motion, `layout` (position) still animates
 * minimally, but the opacity/slide entrance is skipped.
 *
 * The justification is exposed through a Radix `Popover` (keyboard + touch accessible, unlike a
 * native `title` tooltip) rather than hand-rolled disclosure logic, and ambiguous classifications
 * (build guide §5.5) get a subtle always-visible ring around the bucket dot — the ring is the
 * *fact* of ambiguity, the popover is the *reason*, per §5.4's "hover/click to see why."
 */
export function EmailCard({ email, bucketColor }: EmailCardProps) {
  const isUnclassified = email.status === 'unclassified';
  const isAmbiguous = email.isAmbiguous === true;
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
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-100">{email.subject || '(no subject)'}</p>
        {bucketColor && (
          <span className="mt-1 flex shrink-0 items-center gap-1">
            {isAmbiguous && <span className="sr-only">Ambiguous classification</span>}
            <span
              className={`h-2 w-2 rounded-full ${isAmbiguous ? 'ring-2 ring-violet-400 ring-offset-2 ring-offset-slate-900' : ''}`}
              style={{ backgroundColor: bucketColor }}
              aria-hidden="true"
            />
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-400">{email.fromAddress || 'Unknown sender'}</p>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        {email.snippet && <p className="line-clamp-2 text-xs text-slate-500">{email.snippet}</p>}
        <div className="flex shrink-0 items-center">
          {email.hasDeadline && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label="Has a deadline"
                  className="-m-1 shrink-0 rounded p-1.5 text-amber-400 hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M8 4.5v3.8l2.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="top"
                  align="end"
                  sideOffset={6}
                  collisionPadding={12}
                  className="z-50 max-w-64 rounded-md border border-slate-700 bg-slate-800 p-3 text-xs text-slate-200 shadow-lg"
                >
                  <p>{email.deadlineText}</p>
                  <Popover.Arrow className="fill-slate-700" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
          {email.justification && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label="Why this bucket?"
                  className="-m-1 shrink-0 rounded p-1.5 text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M8 7.2v3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <circle cx="8" cy="5.1" r="0.9" fill="currentColor" />
                  </svg>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="top"
                  align="end"
                  sideOffset={6}
                  collisionPadding={12}
                  className="z-50 max-w-64 rounded-md border border-slate-700 bg-slate-800 p-3 text-xs text-slate-200 shadow-lg"
                >
                  <p>{email.justification}</p>
                  {isAmbiguous && email.secondaryBucket && (
                    <p className="mt-1.5 text-violet-300">Also close to: {email.secondaryBucket}</p>
                  )}
                  <Popover.Arrow className="fill-slate-700" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>
      </div>
      {isUnclassified && <p className="mt-1.5 text-xs font-medium text-amber-400">Couldn&rsquo;t be classified</p>}
    </motion.article>
  );
}
