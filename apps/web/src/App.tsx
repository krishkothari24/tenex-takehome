import { useState } from 'react';
import type { InboxSyncResponse } from '@inbox-concierge/shared';
import { useSession } from './hooks/useSession';
import { api } from './api/client';

export default function App() {
  const { user, loading, signIn, signOut } = useSession();
  const [syncResult, setSyncResult] = useState<InboxSyncResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await api.syncInbox();
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <p>Checking your session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-200">
        <h1 className="text-2xl font-semibold">Inbox Concierge</h1>
        <button
          onClick={signIn}
          className="rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          Sign in with Google
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-200">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Inbox Concierge</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">{user.email}</span>
            <button onClick={signOut} className="text-sm text-slate-400 underline hover:text-slate-200">
              Sign out
            </button>
          </div>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          {syncing ? 'Reading your last 200 threads…' : 'Sync my inbox'}
        </button>

        {syncError && <p className="text-red-400">{syncError}</p>}

        {syncResult && (
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs">
            {JSON.stringify(syncResult, null, 2)}
          </pre>
        )}
      </div>
    </main>
  );
}
