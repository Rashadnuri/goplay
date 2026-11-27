import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, BackendNotice, ErrorState, Loading, useToast } from '../components/ui.tsx';
import { ReportModal } from './OnlineGame.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { backendReady, rpc, supabase } from '../lib/supabase.ts';
import type { Profile } from '../lib/types.ts';

interface Msg { id: string; sender_id: string; recipient_id: string; body: string; created_at: string }

export default function Messages() {
  const { userId } = useParams();
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const { fail } = useToast();
  const [peer, setPeer] = useState<Pick<Profile, 'id' | 'username' | 'avatar'> | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [reportMsg, setReportMsg] = useState<Msg | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!supabase || !user || !userId) return;
    try {
      const { data: p } = await supabase.from('profiles').select('id, username, avatar').eq('id', userId).maybeSingle();
      setPeer(p as typeof peer);
      const { data, error: e } = await supabase.from('messages').select('id, sender_id, recipient_id, body, created_at')
        .or(`and(sender_id.eq.${user.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${user.id})`)
        .order('created_at', { ascending: true }).limit(200);
      if (e) throw e;
      setMsgs(data as Msg[]);
      await rpc('mark_messages_read', { p_from: userId });
    } catch (e) { setError(e); }
  }, [user, userId]);

  useEffect(() => {
    void load();
    if (!supabase || !user || !userId) return;
    const ch = supabase.channel(`dm:${user.id}:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${user.id}` }, (pl) => {
        const m = pl.new as Msg;
        if (m.sender_id === userId) { setMsgs((c) => (c.some((x) => x.id === m.id) ? c : [...c, m])); void rpc('mark_messages_read', { p_from: userId }); }
      })
      .subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [load, user, userId]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  if (!backendReady) return <BackendNotice />;
  if (loading) return <Loading />;
  if (!user) return <div className="notice"><Link to="/auth">{t('common.signIn')}</Link></div>;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    try {
      const id = await rpc<string>('send_message', { p_to: userId, p_body: body });
      setMsgs((c) => [...c, { id, sender_id: user.id, recipient_id: userId!, body, created_at: new Date().toISOString() }]);
      setText('');
    } catch (err) { fail(err); }
  };

  return (
    <div className="stack" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="row"><Link to="/friends" className="small muted">←</Link>{peer && <Link to={`/u/${peer.username}`} className="row" style={{ textDecoration: 'none' }}><Avatar name={peer.username} avatar={peer.avatar} size="sm" /><h2 style={{ margin: 0 }}>{peer.username}</h2></Link>}</div>
      <div className="card stack" style={{ minHeight: 280, maxHeight: '60dvh', overflowY: 'auto' }} aria-live="polite">
        {msgs.length === 0 && <div className="empty">{t('social.noMessages')}</div>}
        {msgs.map((m) => {
          const mine = m.sender_id === user.id;
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              <div style={{ background: mine ? 'var(--navy)' : 'var(--bg-2)', color: mine ? 'var(--on-navy)' : 'var(--ink)', padding: '8px 12px', borderRadius: 14, wordBreak: 'break-word' }}>{m.body}</div>
              {!mine && <button className="btn ghost small" style={{ minHeight: 24, padding: '0 6px', fontSize: '.7rem' }} onClick={() => setReportMsg(m)}>{t('social.report')}</button>}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form className="row" onSubmit={send}>
        <input className="input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={t('social.typeMessage')} aria-label={t('social.typeMessage')} />
        <button className="btn primary" disabled={!text.trim()}>{t('common.send')}</button>
      </form>
      {reportMsg && peer && <ReportModal userId={peer.id} messageId={reportMsg.id} onClose={() => setReportMsg(null)} />}
    </div>
  );
}
