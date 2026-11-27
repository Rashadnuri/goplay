import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, AVATAR_KEYS, BackendNotice, Confirm, ErrorState, Field, LeagueBadge, Loading, useToast } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { ReportModal } from './OnlineGame.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { COUNTRY_CODES, countryName, flag } from '../lib/countries.ts';
import { AppError, backendReady, rpc, supabase } from '../lib/supabase.ts';
import type { FriendRow, PlayerRating, Profile } from '../lib/types.ts';

interface Ach { code: string; icon: string }
interface HistoryRow { game_id: string; board_size: number; finished_at: string; result_text: string; won: boolean; draw: boolean; rating_before: number | null; rating_after: number | null; opponent_name: string | null; opponent_avatar: string | null; is_ranked: boolean }
const leagueOf = (r: number) => (r >= 1900 ? 'diamond' : r >= 1700 ? 'platinum' : r >= 1500 ? 'gold' : r >= 1300 ? 'silver' : r >= 1100 ? 'bronze' : 'beginner');
const ICONS: Record<string, string> = { trophy: '🏆', globe: '🌐', stones: '⚫', crown: '👑', flame: '🔥', book: '📖', graduation: '🎓', sun: '☀️', puzzle: '🧩', medal: '🏅' };

export default function ProfilePage() {
  const { username } = useParams();
  const { user, profile: me, loading } = useAuth();
  const { t } = useI18n();
  if (!backendReady) return <div className="stack"><h1>{t('nav.profile')}</h1><BackendNotice /><Link className="btn" to="/settings">{t('settings.title')}</Link></div>;
  if (loading) return <Loading />;
  if (!username && !user) return <div className="empty stack card"><h2>{t('profile.guestTitle')}</h2><p>{t('profile.guestBody')}</p><Link className="btn primary" to="/auth?next=/profile">{t('common.signIn')}</Link><Link className="btn" to="/settings">{t('settings.title')}</Link></div>;
  return <ProfileView username={username ?? me?.username ?? ''} key={username ?? me?.id ?? 'me'} />;
}

function ProfileView({ username }: { username: string }) {
  const { t, lang, fmtDate } = useI18n();
  const { user, profile: me, refreshProfile, isStaff } = useAuth();
  const { toast, fail } = useToast();
  const nav = useNavigate();
  const [p, setP] = useState<Profile | null>(null);
  const [ratings, setRatings] = useState<PlayerRating[]>([]);
  const [allAch, setAllAch] = useState<Ach[]>([]);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [rel, setRel] = useState<FriendRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [report, setReport] = useState(false);
  const [askBlock, setAskBlock] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [trend, setTrend] = useState<number[]>([]);
  const [medals, setMedals] = useState<{ kind: string; label: string | null; board_size: number | null }[]>([]);
  const [stats, setStats] = useState<{ form: string; puzzles: number; medals: number; daily_best: number } | null>(null);
  const [h2h, setH2h] = useState<{ games: number; wins: number; losses: number; draws: number } | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data: prof, error: e1 } = await supabase.from('profiles').select('*').ilike('username', username).maybeSingle();
      if (e1) throw e1;
      if (!prof) throw new AppError('user_not_found');
      setP(prof as Profile);
      const [r, a, ea, h] = await Promise.all([
        supabase.from('player_ratings').select('*').eq('user_id', prof.id).order('board_size'),
        supabase.from('achievements').select('code, icon').order('sort'),
        supabase.from('user_achievements').select('code').eq('user_id', prof.id),
        supabase.rpc('get_match_history', { p_user: prof.id, p_limit: 15 }),
      ]);
      setRatings((r.data ?? []) as PlayerRating[]);
      setAllAch((a.data ?? []) as Ach[]);
      setEarned(new Set((ea.data ?? []).map((x: { code: string }) => x.code)));
      setHistory((h.data ?? []) as HistoryRow[]);
      if (user && user.id !== prof.id) {
        const { data: fl } = await supabase.rpc('get_friends');
        setRel(((fl ?? []) as FriendRow[]).find((f) => f.user_id === prof.id) ?? null);
      }
      const rs = (r.data ?? []) as PlayerRating[];
      const favSize = rs.length ? [...rs].sort((a, b) => b.games - a.games)[0].board_size : 9;
      const { data: hist } = await supabase.from('rating_history').select('new_rating, old_rating').eq('user_id', prof.id).eq('board_size', favSize).order('created_at').limit(60);
      const hh = (hist ?? []) as { new_rating: number; old_rating: number }[];
      setTrend(hh.length ? [hh[0].old_rating, ...hh.map((x) => x.new_rating)] : []);
      const [md, st] = await Promise.all([
        supabase.from('user_medals').select('kind, label, board_size').eq('user_id', prof.id).order('earned_at', { ascending: false }).limit(24),
        supabase.rpc('get_player_stats', { p_user: prof.id }),
      ]);
      setMedals((md.data ?? []) as typeof medals);
      setStats((st.data ?? null) as typeof stats);
      if (user && user.id !== prof.id) { const { data: hh } = await supabase.rpc('get_head_to_head', { p_user: prof.id }); setH2h(hh as typeof h2h); } else setH2h(null);
      setLoaded(true);
    } catch (e) { setError(e); }
  }, [username, user]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!p || !loaded) return <Loading />;
  const isMe = user?.id === p.id;
  const totalGames = ratings.reduce((s, r) => s + r.games, 0);
  const wins = ratings.reduce((s, r) => s + r.wins, 0);
  const losses = ratings.reduce((s, r) => s + r.losses, 0);
  const bestStreak = Math.max(0, ...ratings.map((r) => r.best_streak));
  const fav = totalGames ? [...ratings].sort((a, b) => b.games - a.games)[0].board_size : null;

  const doRpc = async (fn: string, args: Record<string, unknown>, msg?: string) => {
    try { await rpc(fn, args); if (msg) toast(msg); await load(); } catch (e) { fail(e); }
  };
  const challenge = async () => {
    try {
      const room = await rpc<{ game_id: string }>('create_private_game', { p_size: 9, p_initial: 600, p_increment: 5, p_rules: 'japanese', p_komi: null, p_handicap: 0, p_color: 'random' });
      await rpc('invite_friend_to_game', { p_game: room.game_id, p_friend: p.id });
      nav(`/game/${room.game_id}`);
    } catch (e) { fail(e); }
  };

  return (
    <div className="stack">
      <div className="card gold profile-hero pattern stack">
        <div style={{ position: 'relative' }}>
          <Avatar name={p.username} avatar={p.avatar} size="lg" />
        </div>
        <div>
          <h1 style={{ margin: 0 }}>{p.username} {flag(p.country)}</h1>
          <div className="small muted">{p.country ? `${countryName(p.country, lang)} · ` : ''}{t('profile.joined')} {fmtDate(p.created_at)}{p.role !== 'user' ? ` · ${p.role}` : ''}</div>
          {p.bio && <p style={{ margin: '8px 0 0' }}>{p.bio}</p>}
        </div>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          {isMe ? (
            <>
              <button className="btn" onClick={() => setEditing(true)}>{t('profile.edit')}</button>
              <Link className="btn" to="/friends"><Icon name="users" size={18} /> {t('social.friends')}</Link>
              <Link className="btn" to="/settings"><Icon name="cog" size={18} /> {t('settings.title')}</Link>
              {isStaff && <Link className="btn" to="/admin"><Icon name="shield" size={18} /> {t('admin.title')}</Link>}
            </>
          ) : user ? (
            <>
              {!rel && <button className="btn primary" onClick={() => doRpc('send_friend_request', { p_user: p.id }, t('social.requestSent'))}>{t('social.addFriend')}</button>}
              {rel?.status === 'pending' && rel.incoming && <button className="btn primary" onClick={() => doRpc('respond_friend_request', { p_id: rel.friendship_id, p_accept: true })}>{t('common.accept')}</button>}
              {rel?.status === 'pending' && !rel.incoming && <span className="chip">{t('social.pendingOut')}</span>}
              {rel?.status === 'accepted' && (
                <>
                  <Link className="btn" to={`/messages/${p.id}`}><Icon name="msg" size={18} /> {t('social.message')}</Link>
                  <button className="btn primary" onClick={challenge}>{t('social.challenge')}</button>
                  <button className="btn" onClick={() => doRpc('remove_friend', { p_user: p.id })}>{t('social.removeFriend')}</button>
                </>
              )}
              <button className="btn" onClick={() => setReport(true)}>{t('social.report')}</button>
              <button className="btn danger" onClick={() => setAskBlock(true)}>{t('social.block')}</button>
            </>
          ) : null}
        </div>
      </div>

      <div className="stat-row">
        <div><b>{totalGames}</b><span>{t('profile.gamesShort')}</span></div>
        <div><b>{totalGames ? Math.round((wins / Math.max(1, wins + losses)) * 100) : 0}%</b><span>{t('profile.winRate')}</span></div>
        <div><b>{ratings.length ? Math.max(...ratings.map((r) => r.rating)) : 1000}</b><span>{t('game.rating')}</span></div>
      </div>
      {ratings.length > 0 && (
        <div className="league-banner"><Icon name="crown" size={22} /> <LeagueBadge league={leagueOf(Math.max(...ratings.map((r) => r.rating)))} /> <span className="muted small">· {t('profile.bestStreak')}: {bestStreak}{fav ? ` · ${fav}×${fav}` : ''}</span></div>
      )}
      {trend.length > 1 && (
        <div className="card">
          <h3>{t('profile.ratingTrend')}</h3>
          <svg className="rating-chart" viewBox="0 0 300 120" preserveAspectRatio="none" role="img" aria-label={t('profile.ratingTrend')}>
            {(() => {
              const lo = Math.min(...trend) - 20, hi = Math.max(...trend) + 20;
              const pts = trend.map((v, i) => [(i / (trend.length - 1)) * 290 + 5, 110 - ((v - lo) / (hi - lo)) * 100] as const);
              return (<>
                <defs><linearGradient id="rc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d9d2c1" stopOpacity=".25" /><stop offset="1" stopColor="#d9d2c1" stopOpacity="0" /></linearGradient></defs>
                <path d={`M${pts[0][0]} 115 ${pts.map((q) => `L${q[0]} ${q[1]}`).join(' ')} L${pts[pts.length - 1][0]} 115Z`} fill="url(#rc)" />
                <polyline points={pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="#d9d2c1" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                {pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r="2.6" fill="#f1ebdd" vectorEffect="non-scaling-stroke" />)}
              </>);
            })()}
          </svg>
        </div>
      )}

      {stats && (
        <div className="card stack">
          <div className="row between wrap"><strong>{t('stats.form')}</strong>
            <span className="row" style={{ gap: 4 }} aria-label={stats.form}>{stats.form ? [...stats.form].map((c, i) => <span key={i} className={`chip ${c === 'W' ? 'ok' : c === 'L' ? 'bad' : ''}`} style={{ minWidth: 26, justifyContent: 'center' }}>{c === 'W' ? t('profile.w') : c === 'L' ? t('profile.l') : '='}</span>) : <span className="muted small">{t('profile.noGames')}</span>}</span></div>
          <div className="row wrap small muted"><span>🧩 {t('stats.puzzles', { n: stats.puzzles })}</span><span>🔥 {t('stats.dailyBest', { n: stats.daily_best })}</span><span>🏅 {t('stats.medals', { n: stats.medals })}</span></div>
          {h2h && h2h.games > 0 && <div className="notice small">{t('stats.h2h', { w: h2h.wins, l: h2h.losses, d: h2h.draws })}</div>}
        </div>
      )}
      {medals.length > 0 && (
        <section>
          <div className="section-title"><h2>{t('stats.medalsTitle')}</h2></div>
          <div className="row wrap">{medals.map((m, i) => <span key={i} className="chip gold" title={m.label ?? ''}>{m.kind.endsWith('gold') ? '🥇' : m.kind.endsWith('silver') ? '🥈' : '🥉'} {m.kind.startsWith('season') ? t('stats.medalSeason', { s: m.label ?? '' }) : m.label}{m.board_size ? ` · ${m.board_size}×${m.board_size}` : ''}</span>)}</div>
        </section>
      )}

      <section>
        <div className="section-title"><h2>{t('game.rating')}</h2></div>
        <div className="grid three">
          {ratings.map((r) => (
            <div key={r.board_size} className="card">
              <div className="row between"><strong>{r.board_size}×{r.board_size}</strong><LeagueBadge league={leagueOf(r.rating)} /></div>
              <h2 style={{ margin: '4px 0' }}>{r.rating}</h2>
              <div className="small muted">{r.games ? `${r.wins}${t('profile.w')} ${r.losses}${t('profile.l')} · ${t('profile.peak')} ${r.peak_rating}` : t('profile.unrated')}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-title"><h2>{t('profile.achievements')}</h2><span className="small muted">{earned.size}/{allAch.length}</span></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
          {allAch.map((a) => (
            <div key={a.code} className={`ach${earned.has(a.code) ? '' : ' locked'}`} title={t(`ach.${a.code}.desc` as DictKey)}>
              <div className="ico">{ICONS[a.icon] ?? '★'}</div>
              <div className="small"><strong>{t(`ach.${a.code}.name` as DictKey)}</strong></div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-title"><h2>{t('profile.history')}</h2></div>
        {history.length === 0 ? <div className="empty card">{t('profile.noGames')}</div> : (
          <div className="card list">
            {history.map((h) => (
              <Link key={h.game_id} to={`/replay/${h.game_id}`} className="row" style={{ textDecoration: 'none' }}>
                <span className={`chip ${h.draw ? '' : h.won ? 'ok' : 'bad'}`}>{h.draw ? t('profile.draw') : h.won ? t('profile.win') : t('profile.loss')}</span>
                <span className="grow truncate">{h.opponent_name ?? '—'} · {h.board_size}×{h.board_size} · {h.result_text}</span>
                <span className="small muted">{h.rating_before != null && h.rating_after != null ? `${h.rating_after - h.rating_before >= 0 ? '+' : ''}${h.rating_after - h.rating_before}` : ''}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {editing && <EditProfile profile={p} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await refreshProfile(); await load(); }} />}
      {report && <ReportModal userId={p.id} onClose={() => setReport(false)} />}
      {askBlock && <Confirm title={t('social.blockConfirm', { name: p.username })} body={t('social.blockBody')} confirmLabel={t('social.block')} danger onClose={() => setAskBlock(false)} onConfirm={async () => { await doRpc('block_user', { p_user: p.id }, t('social.blocked')); nav('/friends'); }} />}
      {isMe && me && null}
    </div>
  );
}

function EditProfile({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const { fail } = useToast();
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [country, setCountry] = useState(profile.country ?? '');
  const [avatar, setAvatar] = useState(profile.avatar);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase!.from('profiles').update({ username, bio, country: country || null, avatar }).eq('id', profile.id);
    setBusy(false);
    if (error) return fail(/duplicate/.test(error.message) ? new AppError('username_taken') : /username_format/.test(error.message) ? new AppError('invalid_username') : error);
    onSaved();
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('profile.edit')}>
        <h2>{t('profile.edit')}</h2>
        <div className="stack">
          <Field label={t('profile.avatar')}>
            <div className="row wrap">{AVATAR_KEYS.map((k) => <button key={k} type="button" onClick={() => setAvatar(k)} aria-pressed={avatar === k} aria-label={k} style={{ border: avatar === k ? '3px solid var(--gold)' : '3px solid transparent', borderRadius: '50%', background: 'none', padding: 0, cursor: 'pointer' }}><Avatar name={username} avatar={k} /></button>)}</div>
          </Field>
          <Field label={t('auth.username')} hint={t('auth.usernameHint')}><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} /></Field>
          <Field label={t('profile.bio')}><textarea className="input" maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
          <Field label={t('profile.country')}>
            <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">—</option>
              {COUNTRY_CODES.map((c) => <option key={c} value={c}>{flag(c)} {countryName(c, lang)}</option>)}
            </select>
          </Field>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{t('common.save')}</button></div>
      </div>
    </div>
  );
}
