import { useState } from 'react';
import type { FormEvent } from 'react';

interface CreateBucketFormProps {
  onCreate: (name: string) => Promise<void>;
}

/**
 * "Type a new bucket, hit enter" (the assignment's own framing). A plain disable-while-submitting
 * guard — not the `bootstrappedForUserId` ref pattern from App.tsx, which exists specifically to
 * defeat React StrictMode's mount-effect double-invoke; a button's `onClick`/`onSubmit` is never
 * re-invoked by StrictMode, so no cross-render ref guard is needed here.
 */
export function CreateBucketForm({ onCreate }: CreateBucketFormProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting || !name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim());
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that bucket.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
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
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
