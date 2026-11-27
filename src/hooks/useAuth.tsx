import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { backendReady, supabase } from '../lib/supabase.ts';
import type { Profile } from '../lib/types.ts';
import { useI18n } from '../i18n/index.tsx';

interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(backendReady);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!supabase || !uid) return setProfile(null);
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session?.user.id).finally(() => setLoading(false));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      loadProfile(s?.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // adopt the saved language preference of the signed-in user
  useEffect(() => {
    if (profile?.language) setLang(profile.language);
  }, [profile?.language, setLang]);

  // presence heartbeat → "online" status for friends
  useEffect(() => {
    if (!supabase || !session) return;
    const beat = () => {
      if (document.visibilityState === 'visible') void supabase!.rpc('touch_presence');
    };
    beat();
    const t = setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [session]);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      isStaff: profile?.role === 'admin' || profile?.role === 'moderator',
      isAdmin: profile?.role === 'admin',
      refreshProfile: () => loadProfile(session?.user.id),
      signOut: async () => {
        await supabase?.auth.signOut();
        setProfile(null);
      },
    }),
    [session, profile, loading, loadProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}
