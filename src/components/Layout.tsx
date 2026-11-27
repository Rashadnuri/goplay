import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { Brand } from './Logo.tsx';
import { Icon } from './Icon.tsx';
import { Avatar, LanguageSelect } from './ui.tsx';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useTheme } from '../hooks/useTheme.ts';
import { supabase } from '../lib/supabase.ts';
import type { FriendRow } from '../lib/types.ts';

const NAV: { to: string; key: DictKey; icon: string; end?: boolean }[] = [
  { to: '/', key: 'nav.home', icon: 'home', end: true },
  { to: '/play', key: 'nav.play', icon: 'play' },
  { to: '/tournaments', key: 'nav.tournaments', icon: 'trophy' },
  { to: '/learn', key: 'nav.learn', icon: 'book' },
  { to: '/leaderboard', key: 'nav.leaderboard', icon: 'chart' },
  { to: '/profile', key: 'nav.profile', icon: 'user' },
];

function useSocialBadge(): number {
  const { user } = useAuth();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!supabase || !user) return setN(0);
    let alive = true;
    const load = async () => {
      const { data } = await supabase!.rpc('get_friends');
      if (!alive || !data) return;
      const rows = data as FriendRow[];
      const inv = await supabase!.from('game_invites').select('id', { count: 'exact', head: true }).eq('to_user', user.id).eq('status', 'pending');
      setN(rows.reduce((s, f) => s + (f.status === 'pending' && f.incoming ? 1 : 0) + (f.unread ?? 0), 0) + (inv.count ?? 0));
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);
  return n;
}

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { pref, set } = useTheme();
  const { user, profile } = useAuth();
  const badge = useSocialBadge();
  const loc = useLocation();
  const dark = pref === 'dark' || (pref === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);

  const changeLang = async (l: typeof lang) => {
    setLang(l);
    if (supabase && user) await supabase.from('profiles').update({ language: l }).eq('id', user.id);
  };
  const toggleTheme = () => set(dark ? 'light' : 'dark');
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  const controls = (
    <div className="row">
      <LanguageSelect value={lang} onChange={changeLang} />
      <button className="icon-btn" onClick={toggleTheme} aria-label={t('settings.theme')} title={t('settings.theme')}>
        <Icon name={dark ? 'sun' : 'moon'} size={20} />
      </button>
    </div>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" style={{ textDecoration: 'none' }}><Brand withTag /></Link>
        <nav className="bottom-nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon name={n.icon} />
              <span>{t(n.key)}</span>
              {n.to === '/profile' && badge > 0 && <b className="badge-dot">{badge}</b>}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        {controls}
        {profile && <Link to="/profile" className="small muted" style={{ textDecoration: 'none' }}>{profile.username}</Link>}
      </aside>
      <header className="topbar">
        <Link to="/" style={{ textDecoration: 'none' }}><Brand /></Link>
        <div className="row">
          <LanguageSelect value={lang} onChange={changeLang} />
          <Link to={user ? '/profile' : '/auth'} className="icon-btn" aria-label={t('nav.profile')}>{profile ? <Avatar name={profile.username} avatar={profile.avatar} size="sm" /> : <Icon name="user" size={20} />}</Link>
        </div>
      </header>
      <main className="main fade-in" key={loc.pathname}>
        <Outlet />
      </main>
      <nav className="bottom-nav mobile-only" aria-label="Main" style={{ display: undefined }} data-mobile>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icon name={n.icon} />
            <span>{t(n.key)}</span>
            {n.to === '/profile' && badge > 0 && <b className="badge-dot">{badge}</b>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
