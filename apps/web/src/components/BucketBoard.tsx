import { useEffect, useRef, useState } from 'react';
import { LayoutGroup, Reorder, useDragControls, type DragControls } from 'framer-motion';
import type { Bucket, EmailWithClassification } from '@inbox-concierge/shared';
import { EmailCard } from './EmailCard';

interface BucketBoardProps {
  buckets: Bucket[];
  emails: EmailWithClassification[];
  onMoveEmail: (emailId: string, bucketId: string) => void;
  onReorderBuckets: (orderedIds: string[]) => void;
  onDeleteBucket: (bucketId: string) => void;
}

const DELETE_CONFIRM_WINDOW_MS = 4000;

function matchesQuery(email: EmailWithClassification, query: string): boolean {
  const q = query.toLowerCase();
  return (
    (email.subject?.toLowerCase().includes(q) ?? false) ||
    (email.fromAddress?.toLowerCase().includes(q) ?? false) ||
    (email.snippet?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Kanban-style columns, one per bucket plus a trailing "Unsorted" column for emails still
 * streaming in (`status === null`) or that failed classification (`status === 'unclassified'`,
 * per build guide §5.8 — visible, never a silent drop). A client-side search filters this same
 * already-loaded list — no backend round-trip, since the spec's "homepage of any email
 * application" framing implies the usual inbox-search affordance, not a click-into-email one.
 *
 * Columns sit in a single horizontally-scrolling row (fixed widths, `overflow-x-auto`) rather
 * than a wrapping grid, so a new bucket always lands beside the others (scroll right) instead of
 * pushing page height down. Drag-to-reorder (`Reorder.Group`) covers *column* position; "Unsorted"
 * is a synthetic column and renders as a plain sibling after the group — always last, never
 * draggable.
 */
export function BucketBoard({ buckets, emails, onMoveEmail, onReorderBuckets, onDeleteBucket }: BucketBoardProps) {
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();
  const visibleEmails = trimmedQuery ? emails.filter((e) => matchesQuery(e, trimmedQuery)) : emails;

  const sorted = [...buckets].sort((a, b) => a.sortOrder - b.sortOrder);
  const [order, setOrder] = useState<Bucket[]>(sorted);
  // Resyncs local drag-order state whenever the bucket set itself changes (create/delete/reload),
  // not on every render — comparing ids+length is enough since sortOrder-only changes come from
  // our own drag, which already owns `order` locally until the round trip resolves.
  const orderKey = sorted.map((b) => b.id).join(',');
  const prevOrderKey = useRef(orderKey);
  useEffect(() => {
    if (prevOrderKey.current !== orderKey) {
      prevOrderKey.current = orderKey;
      setOrder(sorted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync is keyed on orderKey, not `sorted`'s identity
  }, [orderKey]);

  const unsorted = visibleEmails.filter((e) => e.bucket === null);
  const noMatches = trimmedQuery !== '' && visibleEmails.length === 0;

  function handleDragEnd() {
    onReorderBuckets(order.map((b) => b.id));
  }

  // Cross-column email drag (the mouse-only alternative to EmailCard's popover-based mover, see
  // its doc comment). Each BucketColumn's root carries `data-bucket-key` (a real bucket id, or
  // the 'unsorted' sentinel); `elementFromPoint` at the release point resolves the drop target
  // directly in viewport coordinates, sidestepping any page-scroll coordinate mismatch a manually
  // tracked ref+getBoundingClientRect approach would have. Dropping outside any column, or onto
  // "Unsorted" (there's no "unclassify" action), or back onto the email's current bucket, is a
  // silent no-op — the card's `dragSnapToOrigin` already handles the visual snap-back.
  function handleEmailDragEnd(emailId: string, clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-bucket-key]');
    const bucketKey = target?.dataset.bucketKey;
    if (!bucketKey || bucketKey === 'unsorted') return;
    const bucket = buckets.find((b) => b.id === bucketKey);
    const email = emails.find((e) => e.emailId === emailId);
    if (!bucket || !email || email.bucket === bucket.name) return;
    onMoveEmail(emailId, bucket.id);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search subject, sender, or preview…"
        aria-label="Search emails"
        className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 sm:w-80"
      />
      {noMatches ? (
        <p className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
          No emails match &ldquo;{trimmedQuery}&rdquo;.
        </p>
      ) : (
        <LayoutGroup>
          <div className="flex items-start gap-4 overflow-x-auto pb-2">
            <Reorder.Group as="div" axis="x" values={order} onReorder={setOrder} className="flex items-start gap-4">
              {order.map((bucket) => (
                <DraggableBucketColumn
                  key={bucket.id}
                  bucket={bucket}
                  onColumnDragEnd={handleDragEnd}
                  name={bucket.name}
                  color={bucket.color}
                  emails={visibleEmails.filter((e) => e.bucket === bucket.name)}
                  buckets={buckets}
                  onMoveEmail={onMoveEmail}
                  onDeleteBucket={onDeleteBucket}
                  onEmailDragEnd={handleEmailDragEnd}
                />
              ))}
            </Reorder.Group>
            {unsorted.length > 0 && (
              <div className="shrink-0">
                <BucketColumn
                  bucket={null}
                  name="Unsorted"
                  color={null}
                  emails={unsorted}
                  buckets={buckets}
                  onMoveEmail={onMoveEmail}
                  onDeleteBucket={onDeleteBucket}
                  onEmailDragEnd={handleEmailDragEnd}
                />
              </div>
            )}
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

interface BucketColumnContentProps {
  name: string;
  color: string | null;
  emails: EmailWithClassification[];
  buckets: Bucket[];
  onMoveEmail: (emailId: string, bucketId: string) => void;
  onDeleteBucket: (bucketId: string) => void;
  onEmailDragEnd: (emailId: string, clientX: number, clientY: number) => void;
}

/**
 * Owns the per-column `dragControls` and wraps `BucketColumn` in a `Reorder.Item` with
 * `dragListener={false}` — the column only starts its own (horizontal, whole-column) drag from
 * the dedicated grip handle in its header, never from a bare pointerdown anywhere inside it.
 * Without this, `Reorder.Item`'s default `dragListener` (true) means the *entire column box*
 * listens for pointerdown, so grabbing an `EmailCard`'s own drag handle — a descendant DOM node —
 * would arm the column's drag gesture too (`Reorder.Item`'s pan recognizer is a native listener
 * on an ancestor node, so it fires before React's synthetic event system ever reaches this
 * component's handlers, making `stopPropagation` in the child unreliable here). Scoping both
 * drags to explicit handles sidesteps that ordering problem entirely instead of racing it.
 *
 * `layout="position"` (overriding `Reorder.Item`'s default `layout={true}`) keeps the FLIP
 * animation to x/y position only — with full `layout`, collapsing a column (a plain width class
 * swap) also had the ancestor `Reorder.Item` box try to animate *size*, so the column visually
 * stayed at its old expanded width while its already-shrunk content (text `truncate`) rendered
 * for the new width — the "expands then ellipses" glitch.
 */
function DraggableBucketColumn({
  bucket,
  onColumnDragEnd,
  ...columnProps
}: BucketColumnContentProps & { bucket: Bucket; onColumnDragEnd: () => void }) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={bucket}
      dragListener={false}
      dragControls={dragControls}
      layout="position"
      onDragEnd={onColumnDragEnd}
      className="shrink-0"
    >
      <BucketColumn bucket={bucket} dragControls={dragControls} {...columnProps} />
    </Reorder.Item>
  );
}

function BucketColumn({
  bucket,
  name,
  color,
  emails,
  buckets,
  onMoveEmail,
  onDeleteBucket,
  onEmailDragEnd,
  dragControls,
}: BucketColumnContentProps & {
  bucket: Bucket | null;
  /** Only set for real buckets (via `DraggableBucketColumn`) — "Unsorted" isn't reorderable. */
  dragControls?: DragControls;
}) {
  // Component-local, not persisted — resets on reload by design; this is a screen-space control,
  // not a saved preference.
  const [collapsed, setCollapsed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    };
  }, []);

  function handleDeleteClick() {
    if (!bucket) return;
    if (confirmingDelete) {
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
      setConfirmingDelete(false);
      onDeleteBucket(bucket.id);
      return;
    }
    setConfirmingDelete(true);
    deleteTimeoutRef.current = setTimeout(() => setConfirmingDelete(false), DELETE_CONFIRM_WINDOW_MS);
  }

  return (
    <section
      data-bucket-key={bucket ? bucket.id : 'unsorted'}
      className={`flex shrink-0 flex-col gap-2 ${collapsed ? 'w-fit max-w-40' : 'w-72'}`}
    >
      <header className="flex min-w-0 items-center justify-between gap-1 px-1">
        <div className="flex min-w-0 items-center gap-0.5">
          {dragControls && (
            <button
              type="button"
              onPointerDown={(e) => dragControls.start(e)}
              aria-hidden="true"
              tabIndex={-1}
              className="shrink-0 cursor-grab touch-none rounded p-0.5 text-slate-700 hover:text-slate-500 active:cursor-grabbing"
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
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}`}
            title={collapsed ? name : undefined}
            className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-sm font-semibold text-slate-200 hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color ?? '#64748B' }}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{name}</span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-slate-500">{emails.length}</span>
          {bucket && !bucket.isDefault && !collapsed && (
            <button
              type="button"
              onClick={handleDeleteClick}
              aria-label={confirmingDelete ? `Confirm delete ${name}` : `Delete ${name}`}
              title={confirmingDelete ? 'Confirm delete?' : 'Delete bucket'}
              className={`-m-1 shrink-0 rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${
                confirmingDelete ? 'text-red-400 hover:text-red-300' : 'text-slate-600 hover:text-slate-300'
              }`}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
                <path
                  d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </header>
      {!collapsed && (
        <div className="flex flex-col gap-2 pr-1">
          {emails.map((email) => (
            <EmailCard
              key={email.emailId}
              email={email}
              bucketColor={color}
              buckets={buckets}
              onMove={onMoveEmail}
              onDragEnd={onEmailDragEnd}
            />
          ))}
          {emails.length === 0 && (
            <p className="rounded-md border border-dashed border-slate-800 p-3 text-center text-xs text-slate-600">
              Empty
            </p>
          )}
        </div>
      )}
    </section>
  );
}
