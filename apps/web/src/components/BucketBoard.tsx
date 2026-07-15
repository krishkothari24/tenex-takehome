import { LayoutGroup } from 'framer-motion';
import type { Bucket, EmailWithClassification } from '@inbox-concierge/shared';
import { EmailCard } from './EmailCard';

interface BucketBoardProps {
  buckets: Bucket[];
  emails: EmailWithClassification[];
}

/**
 * Kanban-style columns, one per bucket plus a trailing "Unsorted" column for emails still
 * streaming in (`status === null`) or that failed classification (`status === 'unclassified'`,
 * per build guide §5.8 — visible, never a silent drop).
 */
export function BucketBoard({ buckets, emails }: BucketBoardProps) {
  const sorted = [...buckets].sort((a, b) => a.sortOrder - b.sortOrder);
  const unsorted = emails.filter((e) => e.bucket === null);

  return (
    <LayoutGroup>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {sorted.map((bucket) => (
          <BucketColumn
            key={bucket.id}
            name={bucket.name}
            color={bucket.color}
            emails={emails.filter((e) => e.bucket === bucket.name)}
          />
        ))}
        {unsorted.length > 0 && <BucketColumn name="Unsorted" color={null} emails={unsorted} />}
      </div>
    </LayoutGroup>
  );
}

function BucketColumn({
  name,
  color,
  emails,
}: {
  name: string;
  color: string | null;
  emails: EmailWithClassification[];
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
          <EmailCard key={email.emailId} email={email} bucketColor={color} />
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
