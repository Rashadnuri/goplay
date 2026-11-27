import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal, useToast } from './ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { rpc, supabase } from '../lib/supabase.ts';

interface Row { id: string; user_id: string; move_number: number; body: string; created_at: string; profiles?: { username: string } | null }

/** Human commentary by spectators. The database hides it from the players while their game is running. */
export function Commentary({ gameId, moveNumber, canPost, onClose, onJump }: { gameId: string; moveNumber: number; canPost: boolean; onClose: () => void; onJump?: (move: number) => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { fail } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('game_comments').select('id, user_id, move_number, body, created_at, profiles(username)').eq('game_id', gameId).order('created_at').limit(300);
    setRows((data ?? []) as unknown as Row[]);
  }, [gameId]);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const ch = supabase.channel(`comments:${gameId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_comments', filter: `game_id=eq.${gameId}` }, () => void load()).subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [gameId, load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [rows.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    try { await rpc('post_game_comment', { p_game: gameId, p_body: body }); setText(''); await load(); } catch (err) { fail(err); }
  };
  return (
    <Modal title={t('commentary.title')} onClose={onClose}>
      <div className="stack" style={{ minHeight: 200, maxHeight: '45dvh', overflowY: 'auto', gap: 8 }} aria-live="polite">
        {rows.length === 0 && <div className="empty">{t('commentary.empty')}</div>}
        {rows.map((r) => (
          <div key={r.id} style={{ background: r.move_number === moveNumber ? 'var(--gold-soft)' : 'rgba(255,255,255,.04)', borderRadius: 12, padding: '8px 12px' }}>
            <div className="small muted"><Link to={`/u/${r.profiles?.username}`}>{r.profiles?.username}</Link> · {onJump ? <button className="btn ghost small" style={{ minHeight: 22, padding: '0 6px' }} onClick={() => { onJump(r.move_number); onClose(); }}>{t('game.move', { n: r.move_number })}</button> : t('game.move', { n: r.move_number })}</div>
            <div style={{ wordBreak: 'break-word' }}>{r.body}</div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {canPost && user ? (
        <form className="row" onSubmit={send}><input className="input" value={text} maxLength={280} onChange={(e) => setText(e.target.value)} placeholder={t('commentary.placeholder')} aria-label={t('commentary.placeholder')} /><button className="btn primary" disabled={!text.trim()}>{t('common.send')}</button></form>
      ) : <div className="small muted">{user ? t('commentary.playersCannot') : <Link to="/auth">{t('auth.required')}</Link>}</div>}
    </Modal>
  );
}
