import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Bucket,
  DashboardAnalytics,
  Digest,
  EmailWithClassification,
  SenderRuleSuggestion,
} from '@inbox-concierge/shared';
import { useSession } from './hooks/useSession';
import { api } from './api/client';
import { useClassifyStream } from './hooks/useClassifyStream';
import { useDigestStream } from './hooks/useDigestStream';
import { BucketBoard } from './components/BucketBoard';
import { Dashboard } from './components/Dashboard';
import { CreateBucketForm } from './components/CreateBucketForm';
import { BucketPicker } from './components/BucketPicker';
import { DisconnectAccountButton } from './components/DisconnectAccountButton';
import { SenderRuleSuggestionBanner } from './components/SenderRuleSuggestion';

type Phase = 'checking' | 'no-emails' | 'syncing' | 'sync-error' | 'board-error' | 'choosing-buckets' | 'board';
type View = 'dashboard' | 'board';

export default function App() {
  const { user, loading, signIn, signOut, disconnectAndDelete } = useSession();
  const [phase, setPhase] = useState<Phase>('checking');
  const [view, setView] = useState<View>('dashboard');
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [emails, setEmails] = useState<EmailWithClassification[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [ruleSuggestions, setRuleSuggestions] = useState<SenderRuleSuggestion[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const classify = useClassifyStream();
  const digestStream = useDigestStream();

  // Loads persisted emails from Postgres. Zero synced emails → the sign-in-style "Sync my
  // inbox" gate. Zero buckets (a brand-new user — nothing auto-seeds server-side anymore) → the
  // opt-in bucket picker. Otherwise render the board immediately (the instant-reopen path, build
  // guide §4 step 6) and, if any email hasn't been classified yet, kick off the SSE classify
  // stream.
  const loadBoard = useCallback(async () => {
    setErrorMessage(null);
    try {
      const emailsRes = await api.listEmails();
      if (emailsRes.emails.length === 0) {
        setPhase('no-emails');
        return;
      }
      const bucketsRes = await api.listBuckets();
      if (bucketsRes.buckets.length === 0) {
        setBuckets([]);
        setEmails(emailsRes.emails);
        setPhase('choosing-buckets');
        return;
      }
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

  // Loads the last persisted digest, if any — a cheap, non-billable GET, so it's safe alongside
  // loadBoard/loadAnalytics in the same bootstrap effect. Never triggers generation itself.
  const loadDigest = useCallback(async () => {
    try {
      const { digest: persisted } = await api.getDigest();
      setDigest(persisted);
    } catch {
      // Non-critical — the digest panel's own "Generate" button remains available either way.
    }
  }, []);

  // Refetched after every manual move (not on initial load) — this is a signal that only exists
  // once the user has corrected at least a few emails, so an eager fetch on every page load would
  // almost always return nothing.
  const loadRuleSuggestions = useCallback(async () => {
    try {
      const { suggestions } = await api.getRuleSuggestions();
      setRuleSuggestions(suggestions);
    } catch {
      // Non-critical — worst case the suggestion banner just doesn't appear this session.
    }
  }, []);

  useEffect(() => {
    if (!user || bootstrappedForUserId.current === user.id) return;
    bootstrappedForUserId.current = user.id;
    void loadBoard();
    void loadAnalytics();
    void loadDigest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per sign-in, not on every classify identity change
  }, [user]);

  // Mirror the digest stream's terminal result into local state once generation completes — same
  // "subscribe for updates from an external system" pattern as the classify-merge effect below.
  useEffect(() => {
    if (digestStream.status !== 'done' || !digestStream.digest) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDigest(digestStream.digest);
  }, [digestStream.status, digestStream.digest]);

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
          isAmbiguous: update.isAmbiguous,
          hasDeadline: update.hasDeadline,
          deadlineText: update.deadlineText,
        };
      }),
    );
  }, [classify.classifications]);

  // The opt-in picker's submit — creates the selected defaults (one bulk call) and any staged
  // custom names (sequential, reusing the same single-bucket POST the "Add bucket" form uses),
  // then reloads. loadBoard()'s own bucket-count check now finds a non-empty set and falls
  // through to `phase: 'board'`, firing the first-ever `classify.start()` itself — no separate
  // reclassify call needed here, since this is an initial classify pass, not a bucket-set change.
  async function handleFinishBucketPicker(selectedDefaultNames: string[], customNames: string[]) {
    if (selectedDefaultNames.length > 0) await api.createDefaultBuckets(selectedDefaultNames);
    for (const name of customNames) await api.createBucket(name);
    await loadBoard();
  }

  // Create → append the new (empty) column immediately, so it's visible before any
  // classification result arrives — its own small "fast and alive" beat — then trigger the full
  // reclassify stream. `classify.start` already aborts any prior in-flight stream (its existing
  // abortRef guard), so mashing "Add bucket" repeatedly can't fire two concurrent billable runs.
  async function handleCreateBucket(name: string, description?: string) {
    const { bucket } = await api.createBucket(name, description);
    setBuckets((prev) => [...prev, bucket]);
    void classify.start(api.reclassifyStream);
  }

  // Drag-to-reorder bucket *columns* (not emails — see BucketBoard's doc comment). Optimistic
  // local reorder so the drag feels instant; on failure, refetch truth rather than hand-rolling a
  // revert, same pattern as the other mutation handlers below.
  async function handleReorderBuckets(orderedIds: string[]) {
    setBuckets((prev) => {
      const byId = new Map(prev.map((b) => [b.id, b]));
      return orderedIds.map((id, index) => ({ ...byId.get(id)!, sortOrder: index }));
    });
    try {
      await api.reorderBuckets(orderedIds);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not save the new bucket order.');
      await loadBoard();
    }
  }

  // Deleting a bucket immediately unsorts any emails that were in it (rather than leaving them
  // pointed at a bucket that no longer exists) so they show up under "Unsorted" right away, then
  // triggers the same full-reclassify-on-bucket-set-change path used for bucket *creation* (build
  // guide §5.6) so those emails get properly re-sorted into the remaining buckets.
  async function handleDeleteBucket(bucketId: string) {
    const deleted = buckets.find((b) => b.id === bucketId);
    setBuckets((prev) => prev.filter((b) => b.id !== bucketId));
    if (deleted) {
      setEmails((prev) => prev.map((e) => (e.bucket === deleted.name ? { ...e, bucket: null } : e)));
    }
    try {
      await api.deleteBucket(bucketId);
      void classify.start(api.reclassifyStream);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not delete that bucket.');
      await loadBoard();
    }
  }

  // The manual correction (build guide §5.7's feedback-loop seed) — merges the server's response
  // straight into local state (it already reflects the cleared justification/confidence, same
  // shape GET /api/emails returns) and refetches rule suggestions, since this correction might be
  // the one that crosses the "always do this?" threshold for its sender.
  async function handleMoveEmail(emailId: string, bucketId: string) {
    try {
      const { email } = await api.moveEmailBucket(emailId, bucketId);
      setEmails((prev) => prev.map((e) => (e.emailId === emailId ? email : e)));
      void loadRuleSuggestions();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not move that email.');
    }
  }

  // Accepting a suggestion also applies it to every already-synced email from that sender
  // (server-side), so reload the board to reflect those, not just remove the banner.
  async function handleAcceptRule(suggestion: SenderRuleSuggestion) {
    try {
      await api.createRule(suggestion.fromAddress, suggestion.bucketId);
      setRuleSuggestions((prev) => prev.filter((s) => s.fromAddress !== suggestion.fromAddress));
      await loadBoard();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not create that rule.');
    }
  }

  // Client-side only, by design (see SenderRuleSuggestion.tsx doc comment) — no "don't ask again"
  // persistence for a signal this small.
  function handleDismissRule(suggestion: SenderRuleSuggestion) {
    setRuleSuggestions((prev) => prev.filter((s) => s.fromAddress !== suggestion.fromAddress));
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

  // The always-available counterpart to handleSync's onboarding-only gate: lets the user pull new
  // Gmail threads without leaving the populated board. Local `isSyncing` (not `phase`) so the
  // board stays mounted while this runs — `phase='syncing'` unmounts everything, which is right
  // for onboarding but wrong for a resync mid-session. Reuses the same idempotent
  // /api/inbox/sync + loadBoard() pair, so any newly-inserted emails fall through loadBoard's
  // existing `status === null` check and get classified automatically.
  async function handleManualSync() {
    setIsSyncing(true);
    setErrorMessage(null);
    setSyncMessage(null);
    try {
      const res = await api.syncInbox();
      await loadBoard();
      const failedNote = res.failed.length > 0 ? ` (${res.failed.length} couldn't be read)` : '';
      setSyncMessage(`Checked your inbox — ${res.count} thread${res.count === 1 ? '' : 's'} synced${failedNote}.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not check for new emails.');
    } finally {
      setIsSyncing(false);
    }
  }

  if (loading) {
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

  // Narrow window: signed in, but the bootstrap effect's loadBoard() hasn't resolved a phase
  // yet — `phase` only leaves 'checking' via loadBoard, which is itself gated on `user` being
  // truthy (see the bootstrap effect above), so this branch must come after the `!user` check,
  // not be folded into the `loading` check above — a signed-out visitor's `phase` never advances,
  // and conflating the two left them stuck on "Checking your inbox…" forever instead of reaching
  // the sign-in button.
  if (phase === 'checking') {
    return (
      <Centered>
        <p>Checking your inbox…</p>
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

  if (phase === 'choosing-buckets') {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Set up your buckets</h1>
        <p className="mt-2 max-w-md text-center text-sm text-slate-400">
          Pick a starting taxonomy, add your own, or both — you can always add or delete more later.
        </p>
        <div className="mt-4 w-full max-w-lg">
          <BucketPicker onFinish={handleFinishBucketPicker} />
        </div>
        {errorMessage && <p className="mt-3 text-red-400">{errorMessage}</p>}
      </Centered>
    );
  }

  if (phase === 'board-error') {
    return (
      <Centered>
        <p className="text-red-400">{errorMessage ?? 'Something went wrong.'}</p>
        <button
          onClick={() => void loadBoard()}
          className="mt-4 rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
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
            <button
              onClick={() => void handleManualSync()}
              disabled={isSyncing}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
            >
              {isSyncing ? 'Checking…' : 'Check for new emails'}
            </button>
            <DisconnectAccountButton onConfirm={() => void disconnectAndDelete()} />
            <button
              onClick={signOut}
              className="rounded text-sm text-slate-400 underline hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
            >
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

        <div aria-live="polite" role="status" className="space-y-1">
          {syncMessage && !isSyncing && <p className="text-sm text-slate-400">{syncMessage}</p>}
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
        </div>

        {view === 'dashboard' ? (
          analyticsError ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm text-red-400">{analyticsError}</p>
              <button
                onClick={() => void loadAnalytics()}
                className="mt-3 rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
              >
                Try again
              </button>
            </div>
          ) : analytics ? (
            <Dashboard
              analytics={analytics}
              digest={digest}
              digestStatus={digestStream.status}
              digestInputEmailCount={digestStream.inputEmailCount}
              digestErrorMessage={digestStream.errorMessage}
              onGenerateDigest={() => void digestStream.start()}
            />
          ) : (
            <p className="text-sm text-slate-400">Crunching your inbox numbers…</p>
          )
        ) : (
          <>
            <CreateBucketForm onCreate={handleCreateBucket} />
            {ruleSuggestions.length > 0 && (
              <div className="space-y-2">
                {ruleSuggestions.map((suggestion) => (
                  <SenderRuleSuggestionBanner
                    key={suggestion.fromAddress}
                    suggestion={suggestion}
                    onAccept={() => void handleAcceptRule(suggestion)}
                    onDismiss={() => handleDismissRule(suggestion)}
                  />
                ))}
              </div>
            )}
            <BucketBoard
              buckets={buckets}
              emails={emails}
              onMoveEmail={handleMoveEmail}
              onReorderBuckets={handleReorderBuckets}
              onDeleteBucket={(bucketId) => void handleDeleteBucket(bucketId)}
            />
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
