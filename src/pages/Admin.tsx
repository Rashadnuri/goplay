import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BackendNotice, Confirm, ErrorState, Field, Loading, Seg, useToast } from '../components/ui.tsx';
import { LESSONS } from '../content/lessons.ts';
import { BANK } from '../content/bank.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { AppError, backendReady, rpc, supabase } from '../lib/supabase.ts';
import type { Lang, Lesson, Localized, TournamentRow } from '../lib/types.ts';

type Tab = 'stats' | 'users' | 'tournaments' | 'reports' | 'messages' | 'lessons' | 'daily';

/**
 * UI for staff. Visibility here is a convenience only — every action below is authorised again
 * inside the database (RLS policies and SECURITY DEFINER functions that check profiles.role).
 */
export default function Admin() {
  const { t } = useI18n();
  const { isStaff, isAdmin, loading, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'stats';
  const setTab = (x: Tab) => setParams({ tab: x });

  if (!backendReady) return <BackendNotice />;
  if (loading) return <Loading />;
  if (!user) return <div className="notice"><Link to="/auth?next=/admin">{t('common.signIn')}</Link></div>;
  if (!isStaff) return <div className="notice error" role="alert">{t('err.forbidden')}</div>;

  const tabs: { id: Tab; admin?: boolean }[] = [{ id: 'stats' }, { id: 'users' }, { id: 'tournaments', admin: true }, { id: 'reports' }, { id: 'messages' }, { id: 'lessons', admin: true }, { id: 'daily', admin: true }];
  return (
    <div className="stack">
      <h1>{t('admin.title')}</h1>
      <div className="tabs" role="tablist">
        {tabs.filter((x) => !x.admin || isAdmin).map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>{t(`admin.tab.${x.id}` as DictKey)}</button>)}
      </div>
      {tab === 'stats' && <Stats />}
      {tab === 'users' && <Users isAdmin={isAdmin} />}
      {tab === 'tournaments' && isAdmin && <TournamentsAdmin />}
      {tab === 'reports' && <Reports />}
      {tab === 'messages' && <MessagesAdmin />}
      {tab === 'lessons' && isAdmin && <LessonsAdmin />}
      {tab === 'daily' && isAdmin && <DailyAdmin />}
    </div>
  );
}

function Stats() {
  const { t } = useI18n();
  const [s, setS] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => { rpc<Record<string, number>>('admin_stats').then(setS).catch(setErr); }, []);
  useEffect(load, [load]);
  if (err) return <ErrorState error={err} onRetry={load} />;
  if (!s) return <Loading />;
  return (
    <div className="grid three">
      {Object.entries(s).map(([k, v]) => <div key={k} className="card center"><div className="small muted">{t(`admin.stat.${k}` as DictKey)}</div><h2 style={{ margin: 0 }}>{v}</h2></div>)}
    </div>
  );
}

interface UserRow { id: string; username: string; email: string; role: string; banned_until: string | null; created_at: string; last_seen_at: string | null; games: number }
function Users({ isAdmin }: { isAdmin: boolean }) {
  const { t, fmtDate } = useI18n();
  const { toast, fail } = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [banning, setBanning] = useState<UserRow | null>(null);
  const load = useCallback(async () => { try { setRows(await rpc<UserRow[]>('admin_list_users', { p_search: q, p_limit: 50, p_offset: 0 })); } catch (e) { fail(e); } }, [q, fail]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: string, args: Record<string, unknown>) => { try { await rpc(fn, args); toast(t('common.saved')); await load(); } catch (e) { fail(e); } };
  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); void load(); }}><input className="input" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn primary">{t('common.search')}</button></form>
      {!rows ? <Loading /> : (
        <div className="card" style={{ padding: 4 }}><div className="table-wrap"><table className="tbl">
          <thead><tr><th>{t('lb.player')}</th><th>Email</th><th>{t('admin.role')}</th><th className="num">{t('profile.games')}</th><th /></tr></thead>
          <tbody>{rows.map((u) => {
            const banned = u.banned_until && new Date(u.banned_until) > new Date();
            return (
              <tr key={u.id}>
                <td><Link to={`/u/${u.username}`}>{u.username}</Link><div className="small muted">{fmtDate(u.created_at)}</div></td>
                <td className="small">{u.email}</td>
                <td>{isAdmin ? <select className="input" style={{ minHeight: 34, padding: '2px 8px' }} value={u.role} onChange={(e) => act('admin_set_role', { p_user: u.id, p_role: e.target.value })}><option value="user">user</option><option value="moderator">moderator</option><option value="admin">admin</option></select> : u.role}</td>
                <td className="num">{u.games}</td>
                <td>{banned ? <button className="btn small" onClick={() => act('admin_ban_user', { p_user: u.id, p_until: null, p_reason: null })}>{t('admin.unban')}</button> : <button className="btn small danger" onClick={() => setBanning(u)}>{t('admin.ban')}</button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}
      {banning && <Confirm title={t('admin.banConfirm', { name: banning.username })} confirmLabel={t('admin.ban')} danger onClose={() => setBanning(null)} onConfirm={() => act('admin_ban_user', { p_user: banning.id, p_until: new Date(Date.now() + 7 * 86400_000).toISOString(), p_reason: 'moderation' })} body={t('admin.banBody')} />}
    </div>
  );
}

function TournamentsAdmin() {
  const { t, fmtDate } = useI18n();
  const { toast, fail } = useToast();
  const [list, setList] = useState<TournamentRow[]>([]);
  const [f, setF] = useState({ name: '', description: '', format: 'single_elimination', size: 9, rules: 'japanese', initial: 600, increment: 5, min: 2, max: 16, closes: '', starts: '', forfeit: 60 });
  const load = useCallback(() => { supabase!.from('tournaments').select('*').order('created_at', { ascending: false }).limit(30).then(({ data }) => setList((data ?? []) as TournamentRow[])); }, []);
  useEffect(load, [load]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await rpc('create_tournament', { p_name: f.name, p_description: f.description, p_format: f.format, p_size: f.size, p_rules: f.rules, p_initial: f.initial, p_increment: f.increment, p_min: f.min, p_max: f.max, p_closes: f.closes ? new Date(f.closes).toISOString() : null, p_starts: f.starts ? new Date(f.starts).toISOString() : null, p_forfeit_minutes: f.forfeit, p_komi: null });
      toast(t('common.saved')); setF({ ...f, name: '', description: '' }); load();
    } catch (err) { fail(err); }
  };
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));
  const [season, setSeason] = useState(() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); });
  const run = async (fn: string, args: Record<string, unknown> = {}) => { try { const n = await rpc<number>(fn, args); toast(`${t('common.saved')}: ${n}`); load(); } catch (err) { fail(err); } };
  return (
    <div className="stack">
      <div className="card stack">
        <h3>{t('admin.automation')}</h3>
        <p className="small muted" style={{ margin: 0 }}>{t('admin.automationHelp')}</p>
        <div className="row wrap">
          <button className="btn" onClick={() => run('ensure_weekly_tournaments')}>{t('admin.createWeekly')}</button>
          <button className="btn" onClick={() => run('start_due_tournaments')}>{t('admin.startDue')}</button>
        </div>
        <div className="row wrap"><input className="input" style={{ width: 140 }} value={season} onChange={(e) => setSeason(e.target.value)} placeholder="YYYY-MM" aria-label={t('admin.season')} /><button className="btn" onClick={() => run('close_season', { p_season: season })}>{t('admin.closeSeason')}</button></div>
      </div>
      <form className="card stack" onSubmit={create}>
        <h3>{t('admin.createTournament')}</h3>
        <Field label={t('admin.name')}><input className="input" required minLength={3} maxLength={80} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={t('admin.description')}><textarea className="input" maxLength={1000} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid two">
          <Field label={t('tour.format')}><select className="input" value={f.format} onChange={(e) => set('format', e.target.value)}><option value="single_elimination">{t('tour.single_elimination')}</option><option value="round_robin">{t('tour.round_robin')}</option></select></Field>
          <Field label={t('setup.boardSize')}><select className="input" value={f.size} onChange={(e) => set('size', Number(e.target.value))}>{[9, 13, 19].map((s) => <option key={s} value={s}>{s}×{s}</option>)}</select></Field>
          <Field label={t('setup.rules')}><select className="input" value={f.rules} onChange={(e) => set('rules', e.target.value)}><option value="japanese">{t('rules.japanese')}</option><option value="chinese">{t('rules.chinese')}</option></select></Field>
          <Field label={t('admin.forfeitMinutes')}><input className="input" type="number" min={5} max={10080} value={f.forfeit} onChange={(e) => set('forfeit', Number(e.target.value))} /></Field>
          <Field label={t('admin.initialSeconds')}><input className="input" type="number" min={0} max={7200} value={f.initial} onChange={(e) => set('initial', Number(e.target.value))} /></Field>
          <Field label={t('admin.incrementSeconds')}><input className="input" type="number" min={0} max={120} value={f.increment} onChange={(e) => set('increment', Number(e.target.value))} /></Field>
          <Field label={t('admin.minPlayers')}><input className="input" type="number" min={2} max={128} value={f.min} onChange={(e) => set('min', Number(e.target.value))} /></Field>
          <Field label={t('admin.maxPlayers')}><input className="input" type="number" min={2} max={128} value={f.max} onChange={(e) => set('max', Number(e.target.value))} /></Field>
          <Field label={t('admin.registrationCloses')}><input className="input" type="datetime-local" value={f.closes} onChange={(e) => set('closes', e.target.value)} /></Field>
          <Field label={t('admin.startsAt')}><input className="input" type="datetime-local" value={f.starts} onChange={(e) => set('starts', e.target.value)} /></Field>
        </div>
        <button className="btn primary">{t('common.create')}</button>
      </form>
      <div className="card list">
        {list.map((x) => <div key={x.id} className="row between"><Link to={`/tournaments/${x.id}`}>{x.name}</Link><span className="small muted">{t(`tour.status.${x.status}` as DictKey)} · {fmtDate(x.created_at)}</span></div>)}
        {list.length === 0 && <div className="empty">{t('tour.none')}</div>}
      </div>
    </div>
  );
}

interface ReportRow { id: string; reason: string; details: string; status: string; created_at: string; message_id: string | null; game_id: string | null; reporter: { username: string } | null; reported: { username: string } | null; resolution_note: string | null }
function Reports() {
  const { t, fmtDate } = useI18n();
  const { toast, fail } = useToast();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [msgs, setMsgs] = useState<Record<string, { body: string; hidden: boolean }>>({});
  const load = useCallback(async () => {
    let q = supabase!.from('reports').select('*, reporter:profiles!reports_reporter_id_fkey(username), reported:profiles!reports_reported_id_fkey(username)').order('created_at', { ascending: false }).limit(50);
    if (filter === 'open') q = q.in('status', ['open', 'reviewing']);
    const { data, error } = await q;
    if (error) return fail(error);
    const r = data as unknown as ReportRow[];
    setRows(r);
    const ids = r.map((x) => x.message_id).filter(Boolean) as string[];
    if (ids.length) {
      const m = await supabase!.from('messages').select('id, body, hidden').in('id', ids);
      setMsgs(Object.fromEntries((m.data ?? []).map((x: { id: string; body: string; hidden: boolean }) => [x.id, x])));
    }
  }, [filter, fail]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: string, args: Record<string, unknown>) => { try { await rpc(fn, args); toast(t('common.saved')); await load(); } catch (e) { fail(e); } };
  return (
    <div className="stack">
      <Seg value={filter} onChange={setFilter} options={[{ value: 'open', label: t('admin.openReports') }, { value: 'all', label: t('admin.allReports') }]} />
      {!rows ? <Loading /> : rows.length === 0 ? <div className="empty card">{t('admin.noReports')}</div> : rows.map((r) => (
        <div key={r.id} className="card stack">
          <div className="row between wrap"><strong>{r.reported?.username} <span className="muted">← {r.reporter?.username}</span></strong><span className="chip">{t(`report.${r.reason}` as DictKey)} · {r.status}</span></div>
          {r.details && <p style={{ margin: 0 }}>{r.details}</p>}
          {r.message_id && msgs[r.message_id] && <div className="notice small">“{msgs[r.message_id].body}” {msgs[r.message_id].hidden && <em>({t('admin.hidden')})</em>}</div>}
          <div className="small muted">{fmtDate(r.created_at)}{r.game_id && <> · <Link to={`/game/${r.game_id}`}>{t('admin.viewGame')}</Link></>}</div>
          <div className="row wrap">
            {r.message_id && <button className="btn small" onClick={() => act('admin_hide_message', { p_message: r.message_id, p_hidden: !msgs[r.message_id!]?.hidden })}>{msgs[r.message_id]?.hidden ? t('admin.unhide') : t('admin.hideMessage')}</button>}
            <button className="btn small" onClick={() => act('admin_resolve_report', { p_report: r.id, p_status: 'reviewing', p_note: null })}>{t('admin.reviewing')}</button>
            <button className="btn small primary" onClick={() => act('admin_resolve_report', { p_report: r.id, p_status: 'resolved', p_note: null })}>{t('admin.resolve')}</button>
            <button className="btn small" onClick={() => act('admin_resolve_report', { p_report: r.id, p_status: 'dismissed', p_note: null })}>{t('admin.dismiss')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface AdminMsg { id: string; sender_name: string; recipient_name: string; body: string; created_at: string; hidden: boolean }
function MessagesAdmin() {
  const { t, fmtDate } = useI18n();
  const { fail, toast } = useToast();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<AdminMsg[] | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await supabase!.from('profiles').select('id').ilike('username', name.trim()).maybeSingle();
      if (!data) throw new AppError('user_not_found');
      setUid(data.id);
      setRows(await rpc<AdminMsg[]>('admin_list_messages', { p_user: data.id, p_limit: 100 }));
    } catch (err) { fail(err); }
  };
  const hide = async (m: AdminMsg) => { try { await rpc('admin_hide_message', { p_message: m.id, p_hidden: !m.hidden }); toast(t('common.saved')); if (uid) setRows(await rpc<AdminMsg[]>('admin_list_messages', { p_user: uid, p_limit: 100 })); } catch (e) { fail(e); } };
  return (
    <div className="stack">
      <div className="notice small">{t('admin.messagesAudit')}</div>
      <form className="row" onSubmit={search}><input className="input" placeholder={t('auth.username')} value={name} onChange={(e) => setName(e.target.value)} /><button className="btn primary">{t('common.search')}</button></form>
      {rows && (rows.length === 0 ? <div className="empty card">{t('social.noMessages')}</div> : (
        <div className="card list">{rows.map((m) => (
          <div key={m.id} className="row between wrap"><span className="grow"><strong>{m.sender_name}</strong> → {m.recipient_name} <span className="small muted">{fmtDate(m.created_at)}</span><br />{m.hidden ? <em className="muted">{t('admin.hidden')}: </em> : null}{m.body}</span>
            <button className="btn small" onClick={() => hide(m)}>{m.hidden ? t('admin.unhide') : t('admin.hideMessage')}</button></div>
        ))}</div>
      ))}
    </div>
  );
}

const emptyL = (): Localized => ({ az: '', en: '', ru: '' });
function LocalizedInputs({ label, value, onChange, area }: { label: string; value: Localized; onChange: (v: Localized) => void; area?: boolean }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">{label}</span>
      {(['az', 'en', 'ru'] as Lang[]).map((l) => (
        <div key={l} className="row" style={{ alignItems: 'flex-start' }}>
          <span className="chip">{l.toUpperCase()}</span>
          {area ? <textarea className="input" value={value[l]} onChange={(e) => onChange({ ...value, [l]: e.target.value })} /> : <input className="input" value={value[l]} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />}
        </div>
      ))}
    </div>
  );
}

function LessonsAdmin() {
  const { t, loc } = useI18n();
  const { toast, fail } = useToast();
  const [rows, setRows] = useState<Lesson[]>([]);
  const [edit, setEdit] = useState<(Lesson & { stepsJson: string; isNew?: boolean }) | null>(null);
  const load = useCallback(() => { supabase!.from('lessons').select('*').order('position').then(({ data }) => setRows((data ?? []) as Lesson[])); }, []);
  useEffect(load, [load]);
  const importBundled = async () => {
    const have = new Set(rows.map((r) => r.slug));
    const missing = LESSONS.filter((l) => !have.has(l.slug)).map((l) => ({ slug: l.slug, position: l.position, level: l.level, title: l.title, summary: l.summary, steps: l.steps, published: true }));
    if (!missing.length) return toast(t('admin.nothingToImport'));
    const { error } = await supabase!.from('lessons').insert(missing);
    if (error) fail(error); else { toast(t('common.saved')); load(); }
  };
  const save = async () => {
    if (!edit) return;
    try {
      let steps: unknown;
      try { steps = JSON.parse(edit.stepsJson); } catch { throw new AppError('invalid_json'); }
      if (!Array.isArray(steps)) throw new AppError('invalid_json');
      const row = { slug: edit.slug, position: edit.position, level: edit.level, title: edit.title, summary: edit.summary, steps, published: edit.published ?? true };
      const { error } = edit.isNew ? await supabase!.from('lessons').insert(row) : await supabase!.from('lessons').update(row).eq('slug', edit.slug);
      if (error) throw error;
      toast(t('common.saved')); setEdit(null); load();
    } catch (e) { fail(e); }
  };
  const remove = async (slug: string) => { const { error } = await supabase!.from('lessons').delete().eq('slug', slug); if (error) fail(error); else load(); };
  return (
    <div className="stack">
      <div className="row wrap">
        <button className="btn primary" onClick={() => setEdit({ slug: '', position: rows.length + 1, level: 1, title: emptyL(), summary: emptyL(), steps: [], stepsJson: '[]', published: true, isNew: true })}>{t('common.create')}</button>
        <button className="btn" onClick={importBundled}>{t('admin.importBundled')}</button>
      </div>
      <div className="card list">
        {rows.length === 0 && <div className="empty">{t('admin.noLessonsDb')}</div>}
        {rows.map((l) => (
          <div key={l.slug} className="row between wrap">
            <span>#{l.position} · {loc(l.title)} <span className="chip">{l.published ? t('admin.published') : t('admin.draft')}</span></span>
            <span className="row"><button className="btn small" onClick={() => setEdit({ ...l, stepsJson: JSON.stringify(l.steps, null, 2) })}>{t('admin.edit')}</button><button className="btn small danger" onClick={() => remove(l.slug)}>{t('common.delete')}</button></span>
          </div>
        ))}
      </div>
      {edit && (
        <div className="card stack">
          <h3>{edit.isNew ? t('common.create') : t('admin.edit')}</h3>
          <div className="grid three">
            <Field label="slug"><input className="input" value={edit.slug} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} pattern="[a-z0-9-]{2,40}" /></Field>
            <Field label={t('admin.position')}><input className="input" type="number" value={edit.position} onChange={(e) => setEdit({ ...edit, position: Number(e.target.value) })} /></Field>
            <Field label={t('admin.level')}><input className="input" type="number" min={1} max={5} value={edit.level} onChange={(e) => setEdit({ ...edit, level: Number(e.target.value) as Lesson['level'] })} /></Field>
          </div>
          <LocalizedInputs label={t('admin.name')} value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
          <LocalizedInputs label={t('admin.description')} value={edit.summary} onChange={(v) => setEdit({ ...edit, summary: v })} />
          <Field label={t('admin.stepsJson')} hint={t('admin.stepsHelp')}><textarea className="input" style={{ minHeight: 220, fontFamily: 'ui-monospace, monospace', fontSize: '.8rem' }} value={edit.stepsJson} onChange={(e) => setEdit({ ...edit, stepsJson: e.target.value })} /></Field>
          <label className="row"><input type="checkbox" checked={edit.published ?? true} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} /> {t('admin.published')}</label>
          <div className="row"><button className="btn primary" onClick={save}>{t('common.save')}</button><button className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button></div>
        </div>
      )}
    </div>
  );
}

interface DailyRow { day: string; difficulty: number; puzzle_id: string | null }
function DailyAdmin() {
  const { t, fmtDate } = useI18n();
  const { toast, fail } = useToast();
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [day, setDay] = useState(new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  const [diff, setDiff] = useState<1 | 2 | 3>(1);
  const [pz, setPz] = useState(BANK.find((p) => p.difficulty === 1)!.id);
  const load = useCallback(() => { supabase!.from('daily_challenges').select('day, difficulty, puzzle_id').gte('day', new Date().toISOString().slice(0, 10)).order('day').limit(60).then(({ data }) => setRows((data ?? []) as DailyRow[])); }, []);
  useEffect(load, [load]);
  const schedule = async () => {
    const { error } = await supabase!.from('daily_challenges').upsert({ day, difficulty: diff, puzzle_id: pz });
    if (error) fail(error); else { toast(t('common.saved')); load(); }
  };
  const remove = async (d: string, lv: number) => { const { error } = await supabase!.from('daily_challenges').delete().eq('day', d).eq('difficulty', lv); if (error) fail(error); else load(); };
  return (
    <div className="stack">
      <div className="card stack">
        <h3>{t('admin.scheduleChallenge')}</h3>
        <div className="grid two">
          <Field label={t('admin.date')}><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label={t('puzzle.difficulty')}><select className="input" value={diff} onChange={(e) => { const v = Number(e.target.value) as 1 | 2 | 3; setDiff(v); setPz(BANK.find((p) => p.difficulty === v)!.id); }}>{[1, 2, 3].map((d) => <option key={d} value={d}>{t(`puzzle.level.${d}` as DictKey)}</option>)}</select></Field>
          <Field label={t('admin.puzzle')}><select className="input" value={pz} onChange={(e) => setPz(e.target.value)}>{BANK.filter((p) => p.difficulty === diff).map((p) => <option key={p.id} value={p.id}>{t(`puzzle.kind.${p.kind}` as DictKey)} · {p.id}</option>)}</select></Field>
        </div>
        <button className="btn primary" onClick={schedule}>{t('common.save')}</button>
        <p className="small muted" style={{ margin: 0 }}>{t('admin.dailyHelp')}</p>
      </div>
      <div className="card list">
        {rows.length === 0 && <div className="empty">{t('admin.noScheduled')}</div>}
        {rows.map((r) => <div key={`${r.day}-${r.difficulty}`} className="row between"><span>{fmtDate(r.day)} · {t(`puzzle.level.${r.difficulty}` as DictKey)} · {r.puzzle_id}</span><button className="btn small danger" onClick={() => remove(r.day, r.difficulty)}>{t('common.delete')}</button></div>)}
      </div>
    </div>
  );
}
