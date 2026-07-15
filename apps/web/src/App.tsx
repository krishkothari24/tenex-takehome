import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Bucket, DashboardAnalytics, EmailWithClassification } from '@inbox-concierge/shared';
import { useSession } from './hooks/useSession';
import { api } from './api/client';
import { useClassifyStream } from './hooks/useClassifyStream';
import { BucketBoard } from './components/BucketBoard';
import { Dashboard } from './components/Dashboard';
import { CreateBucketForm } from './components/CreateBucketForm';

type Phase = 'checking' | 'no-emails' | 'syncing' | 'sync-error' | 'board-error' | 'board';
type View = 'dashboard' | 'board';

export default function App() {
  const { user, loading, signIn, signOut } = useSession();
  const [phase, setPhase] = useState<Phase>('checking');
  const [view, setView] = useState<View>('dashboard');
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [emails, setEmails] = useState<EmailWithClassification[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const classify = useClassifyStream();

  // Loads persisted emails from Postgres. Zero synced emails → the sign-in-style "Sync my
  // inbox" gate. Otherwise render the board immediately (the instant-reopen path, build guide
  // §4 step 6) and, if any email hasn't been classified yet, kick off the SSE classify stream.
  const loadBoard = useCallback(async () => {
    setErrorMessage(null);
    try {
      const emailsRes = await api.listEmails();
      if (emailsRes.emails.length === 0) {
        setPhase('no-emails');
        return;
      }
      const bucketsRes = await api.listBuckets();
      setBuckets(bucketsRes.buckets);
      setEmails(emailsRes.emails);
      setPhase('board');
      if (emailsRes.emails.some((e) => e.status === null)) void classify.start();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not load your inbox.');
      setPhase('board-error');
    }
  }, [classify]);

  // Fetched eagerly alongside the board (not lazily on tab-click) so switching to the Dashboard
  // tab is instant. Safe to double-fire under StrictMode, unlike loadBoard's classify trigger —
  // a GET here isn't billable.
  const loadAnalytics = useCallback(async () => {
    setAnalyticsError(null);
    try {
      setAnalytics(await api.getAnalytics());
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : 'Could not load your inbox analytics.');
    }
  }, []);

  // Guards against React StrictMode's dev-only double-invoke of mount effects: without this,
  // the effect below would fire loadBoard() twice on first mount, and since loadBoard can kick
  // off a real (billable) POST /api/classify, that meant two concurrent classify runs against
  // the same inbox — caught via Playwright network-log inspection during manual verification,
  // not by typecheck/lint. Keyed on user id so a real sign-out/sign-in cycle still bootstraps.
  const bootstrappedForUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!user || bootstrappedForUserId.current === user.id) return;
    bootstrappedForUserId.current = user.id;
    void loadBoard();
    void loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per sign-in, not on every classify identity change
  }, [user]);

  // Subscribe to the classify stream's external state and mirror it onto the local email list
  // as batches arrive — this is the "subscribe for updates from an external system" case the
  // set-state-in-effect rule allows for.
  useEffect(() => {
    if (classify.classifications.size === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmails((prev) =>
      prev.map((email) => {
        const update = classify.classifications.get(email.emailId);
        if (!update) return email;
        return {
          ...email,
          bucket: update.bucket,
          secondaryBucket: update.secondaryBucket,
          confidence: update.confidence,
          justification: update.justification,
          status: update.status,
        };
      }),
    );
  }, [classify.classifications]);

  // Create → append the new (empty) column immediately, so it's visible before any
  // classification result arrives — its own small "fast and alive" beat — then trigger the full
  // reclassify stream. `classify.start` already aborts any prior in-flight stream (its existing
  // abortRef guard), so mashing "Add bucket" repeatedly can't fire two concurrent billable runs.
  async function handleCreateBucket(name: string) {
    const { bucket } = await api.createBucket(name);
    setBuckets((prev) => [...prev, bucket]);
    void classify.start(api.reclassifyStream);
  }

  // Refresh the dashboard once a (re)classify run finishes, since bucket volumes/time-cost/
  // attention all shift when classifications change — a cheap, non-billable GET. Same
  // "subscribe for updates from an external system" case as the classifications-merge effect
  // above.
  useEffect(() => {
    if (classify.status !== 'done') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAnalytics();
  }, [classify.status, loadAnalytics]);

  async function handleSync() {
    setPhase('syncing');
    setErrorMessage(null);
    try {
      await api.syncInbox();
      await loadBoard();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sync failed');
      setPhase('sync-error');
    }
  }

  if (loading || phase === 'checking') {
    return (
      <Centered>
        <p>Checking your inbox…</p>
      </Centered>
    );
  }

  if (!user) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Inbox Concierge</h1>
        <button onClick={signIn} className="mt-4 rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300">
          Sign in with Google
        </button>
      </Centered>
    );
  }

  if (phase === 'no-emails' || phase === 'syncing' || phase === 'sync-error') {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Inbox Concierge</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-slate-400">
          Sync your Gmail to see your last 200 threads sorted into buckets.
        </p>
        <button
          onClick={handleSync}
          disabled={phase === 'syncing'}
          className="mt-4 rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          {phase === 'syncing' ? 'Reading your last 200 threads…' : 'Sync my inbox'}
        </button>
        {phase === 'sync-error' && errorMessage && <p className="mt-3 text-red-400">{errorMessage}</p>}
      </Centered>
    );
  }

  if (phase === 'board-error') {
    return (
      <Centered>
        <p className="text-red-400">{errorMessage ?? 'Something went wrong.'}</p>
        <button onClick={() => void loadBoard()} className="mt-4 rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400">
          Try again
        </button>
      </Centered>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-200 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Inbox Concierge</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">{user.email}</span>
            <button onClick={signOut} className="text-sm text-slate-400 underline hover:text-slate-200">
              Sign out
            </button>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 text-sm">
          {(['dashboard', 'board'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${
                view === v ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {classify.status === 'running' && (
          <p className="text-sm text-slate-400">
            Sorting your inbox…{' '}
            {classify.batchCount > 0 && `batch ${classify.completedBatches} of ${classify.batchCount}`}
          </p>
        )}
        {classify.status === 'error' && classify.errorMessage && (
          <p className="text-sm text-red-400">{classify.errorMessage}</p>
        )}
        {classify.unclassifiedEmailIds.length > 0 && (
          <p className="text-sm text-amber-400">
            {classify.unclassifiedEmailIds.length} email{classify.unclassifiedEmailIds.length === 1 ? '' : 's'}{' '}
            couldn&rsquo;t be classified — see the Unsorted column.
          </p>
        )}

        {view === 'dashboard' ? (
          analyticsError ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm text-red-400">{analyticsError}</p>
              <button
                onClick={() => void loadAnalytics()}
                className="mt-3 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
              >
                Try again
              </button>
            </div>
          ) : analytics ? (
            <Dashboard analytics={analytics} />
          ) : (
            <p className="text-sm text-slate-400">Crunching your inbox numbers…</p>
          )
        ) : (
          <>
            <CreateBucketForm onCreate={handleCreateBucket} />
            <BucketBoard buckets={buckets} emails={emails} />
          </>
        )}
      </div>
    </main>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-1 bg-slate-950 p-8 text-slate-200">
      {children}
    </main>
  );
}
