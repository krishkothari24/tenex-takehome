import { useRef } from 'react';
import { motion, useDragControls, useReducedMotion } from 'framer-motion';
import * as Popover from '@radix-ui/react-popover';
import type { Bucket, EmailWithClassification } from '@inbox-concierge/shared';

interface EmailCardProps {
  email: EmailWithClassification;
  bucketColor: string | null;
  buckets: Bucket[];
  onMove: (emailId: string, bucketId: string) => void;
  /** Fires on drag release with the pointer's viewport coordinates — `BucketBoard` resolves which
   *  column (if any) is under that point via `document.elementFromPoint` and calls `onMove` for a
   *  valid drop; a no-op elsewhere just leaves the classification untouched. */
  onDragEnd: (emailId: string, clientX: number, clientY: number) => void;
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
 *
 * The "move to a different bucket" affordance (a feedback-loop seed) is a third icon in the same
 * row (Popover-based, full keyboard/screen-reader support) — the *only* move path for keyboard/
 * screen-reader users, so it stays even though drag-and-drop (below) now also exists as a faster
 * mouse-only alternative. Drag is deliberately gated to a dedicated grip handle
 * (`dragListener={false}` + `useDragControls`) rather than the whole card, so it can't fight the
 * page's vertical scroll or hijack normal clicks on the card's other icon-buttons; the
 * handle itself is `aria-hidden`/`tabIndex={-1}` since it has no keyboard equivalent.
 */
export function EmailCard({ email, bucketColor, buckets, onMove, onDragEnd }: EmailCardProps) {
  const isUnclassified = email.status === 'unclassified';
  const isAmbiguous = email.isAmbiguous === true;
  const reduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  const cardRef = useRef<HTMLElement>(null);

  return (
    <motion.article
      ref={cardRef}
      layout
      layoutId={email.emailId}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
      drag={!reduceMotion}
      dragControls={dragControls}
      dragListener={false}
      dragSnapToOrigin
      dragElastic={0.12}
      whileDrag={{ scale: 1.03, zIndex: 30, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
      onDragEnd={(event) => {
        const point = event as PointerEvent;
        if (typeof point.clientX !== 'number') return;
        // Exclude the dragged card itself from the drop-target hit test: at release it's still
        // painted under the cursor (elevated by `whileDrag`'s zIndex), so without this
        // `elementFromPoint` in BucketBoard would always resolve back to this card's own
        // (source) column instead of whatever's actually beneath it.
        const node = cardRef.current;
        if (node) node.style.pointerEvents = 'none';
        onDragEnd(email.emailId, point.clientX, point.clientY);
        if (node) node.style.pointerEvents = '';
      }}
      className="rounded-lg border border-slate-800 bg-slate-900 p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        {!reduceMotion && (
          <button
            type="button"
            onPointerDown={(e) => dragControls.start(e)}
            aria-hidden="true"
            tabIndex={-1}
            className="-ml-1 mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-slate-700 hover:text-slate-500 active:cursor-grabbing"
          >
            <svg viewBox="0 0 16 16" width="10" height="14" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="3" r="1.2" />
              <circle cx="11" cy="3" r="1.2" />
              <circle cx="5" cy="8" r="1.2" />
              <circle cx="11" cy="8" r="1.2" />
              <circle cx="5" cy="13" r="1.2" />
              <circle cx="11" cy="13" r="1.2" />
            </svg>
          </button>
        )}
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
          {buckets.length > 0 && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label="Move to a different bucket"
                  className="-m-1 shrink-0 rounded p-1.5 text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                    <path
                      d="M2.5 8h9M8 4.5l3.5 3.5-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="top"
                  align="end"
                  sideOffset={6}
                  collisionPadding={12}
                  className="z-50 w-48 rounded-md border border-slate-700 bg-slate-800 p-1 text-xs text-slate-200 shadow-lg"
                >
                  <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Move to
                  </p>
                  {buckets.map((bucket) => (
                    <Popover.Close asChild key={bucket.id}>
                      <button
                        type="button"
                        onClick={() => onMove(email.emailId, bucket.id)}
                        disabled={bucket.name === email.bucket}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-slate-700 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: bucket.color ?? '#64748B' }}
                          aria-hidden="true"
                        />
                        {bucket.name}
                      </button>
                    </Popover.Close>
                  ))}
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
