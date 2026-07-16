import { useState } from 'react';
import type { FormEvent } from 'react';
import { DEFAULT_BUCKETS } from '@inbox-concierge/shared';

interface BucketPickerProps {
  onFinish: (selectedDefaultNames: string[], customNames: string[]) => Promise<void>;
}

/**
 * Shown once, the first time a user has zero buckets (`App.tsx`'s `'choosing-buckets'` phase) —
 * replaces the old silent server-side auto-seed of the five defaults with an explicit opt-in
 * choice. Defaults are pre-checked (opt-out, not opt-in) so "Continue" is enabled from the start
 * without a hard validation block; a user can still deselect all of them as long as they add at
 * least one custom name instead. Custom names are staged as a removable chip list and only
 * actually created on submit, mirroring `CreateBucketForm`'s "type a name" input pattern.
 */
export function BucketPicker({ onFinish }: BucketPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_BUCKETS.map((b) => b.name)));
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleAddCustom(e: FormEvent) {
    e.preventDefault();
    const trimmed = customInput.trim();
    if (!trimmed || customNames.includes(trimmed)) return;
    setCustomNames((prev) => [...prev, trimmed]);
    setCustomInput('');
  }

  function removeCustom(name: string) {
    setCustomNames((prev) => prev.filter((n) => n !== name));
  }

  const canContinue = selected.size > 0 || customNames.length > 0;

  async function handleContinue() {
    if (isSubmitting || !canContinue) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onFinish([...selected], customNames);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your buckets.');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-5 text-left">
      <div className="flex flex-col gap-2">
        {DEFAULT_BUCKETS.map((def) => (
          <label
            key={def.name}
            aria-label={`${def.name}: ${def.description}`}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-800 p-3 hover:border-slate-700"
          >
            <input
              type="checkbox"
              checked={selected.has(def.name)}
              onChange={() => toggle(def.name)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
            />
            <span>
              <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: def.color }} aria-hidden="true" />
                {def.name}
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">{def.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-800 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Add your own (optional)</p>
        <form onSubmit={handleAddCustom} className="flex items-center gap-2">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="Custom bucket name…"
            maxLength={60}
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          />
          <button
            type="submit"
            disabled={!customInput.trim()}
            className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          >
            Add
          </button>
        </form>
        {customNames.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {customNames.map((name) => (
              <li
                key={name}
                className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeCustom(name)}
                  aria-label={`Remove ${name}`}
                  className="text-slate-400 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handleContinue()}
        disabled={isSubmitting || !canContinue}
        className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        {isSubmitting ? 'Setting up…' : 'Continue'}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
