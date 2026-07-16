import { useState } from 'react';
import type { FormEvent } from 'react';

interface CreateBucketFormProps {
  onCreate: (name: string, description?: string) => Promise<void>;
}

/**
 * "Type a new bucket, hit enter" (the assignment's own framing) stays the fast default path; an
 * optional description is progressive disclosure behind a toggle, not a second required field —
 * it's sent verbatim to the classifier's system prompt to ground what belongs in the bucket
 * beyond just its name, but a name alone is still enough to create one. A plain
 * disable-while-submitting guard — not the `bootstrappedForUserId` ref pattern from App.tsx, which
 * exists specifically to defeat React StrictMode's mount-effect double-invoke; a button's
 * `onClick`/`onSubmit` is never re-invoked by StrictMode, so no cross-render ref guard is needed
 * here.
 */
export function CreateBucketForm({ onCreate }: CreateBucketFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting || !name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), description.trim() || undefined);
      setName('');
      setDescription('');
      setShowDescription(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that bucket.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSubmitting}
          placeholder="Add a custom bucket…"
          maxLength={60}
          className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-50 sm:w-64"
        />
        <button
          type="submit"
          disabled={isSubmitting || !name.trim()}
          className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          {isSubmitting ? 'Sorting into it…' : 'Add bucket'}
        </button>
        {!showDescription && (
          <button
            type="button"
            onClick={() => setShowDescription(true)}
            className="text-left text-xs text-slate-400 underline hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 sm:text-nowrap"
          >
            + Add description
          </button>
        )}
      </div>
      {showDescription && (
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSubmitting}
          placeholder="What should the LLM route into this bucket? (optional, helps classification)"
          maxLength={280}
          rows={2}
          className="w-full resize-none rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-50 sm:max-w-md"
        />
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
