import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from '@inbox-concierge/shared';
import { api, UnauthenticatedError } from '../api/client';

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api.me();
      setUser(me);
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        setUser(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount session check, not a state->effect->state cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const signIn = useCallback(() => {
    window.location.href = '/auth/google';
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return { user, loading, signIn, signOut, refresh };
}
