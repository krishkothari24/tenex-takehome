import { useState } from 'react';
import { LayoutGroup } from 'framer-motion';
import type { Bucket, EmailWithClassification } from '@inbox-concierge/shared';
import { EmailCard } from './EmailCard';

interface BucketBoardProps {
  buckets: Bucket[];
  emails: EmailWithClassification[];
  onMoveEmail: (emailId: string, bucketId: string) => void;
}

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
 */
export function BucketBoard({ buckets, emails, onMoveEmail }: BucketBoardProps) {
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();
  const visibleEmails = trimmedQuery ? emails.filter((e) => matchesQuery(e, trimmedQuery)) : emails;

  const sorted = [...buckets].sort((a, b) => a.sortOrder - b.sortOrder);
  const unsorted = visibleEmails.filter((e) => e.bucket === null);
  const noMatches = trimmedQuery !== '' && visibleEmails.length === 0;

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {sorted.map((bucket) => (
              <BucketColumn
                key={bucket.id}
                name={bucket.name}
                color={bucket.color}
                emails={visibleEmails.filter((e) => e.bucket === bucket.name)}
                buckets={buckets}
                onMoveEmail={onMoveEmail}
              />
            ))}
            {unsorted.length > 0 && (
              <BucketColumn name="Unsorted" color={null} emails={unsorted} buckets={buckets} onMoveEmail={onMoveEmail} />
            )}
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

function BucketColumn({
  name,
  color,
  emails,
  buckets,
  onMoveEmail,
}: {
  name: string;
  color: string | null;
  emails: EmailWithClassification[];
  buckets: Bucket[];
  onMoveEmail: (emailId: string, bucketId: string) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <header className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: color ?? '#64748B' }}
            aria-hidden="true"
          />
          {name}
        </h2>
        <span className="text-xs text-slate-500">{emails.length}</span>
      </header>
      <div className="flex flex-col gap-2">
        {emails.map((email) => (
          <EmailCard key={email.emailId} email={email} bucketColor={color} buckets={buckets} onMove={onMoveEmail} />
        ))}
        {emails.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-800 p-3 text-center text-xs text-slate-600">
            Empty
          </p>
        )}
      </div>
    </section>
  );
}
