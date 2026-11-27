import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { rpc } from '../lib/supabase.ts';
import { useActiveGames, type Invite } from '../hooks/useActiveGames.ts';

export default function PlayHub() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { fail } = useToast();
  const nav = useNavigate();
  const { games, invites, reload } = useActiveGames();
  const respond = async (inv: Invite, accept: boolean) => {
    try { const gid = await rpc<string | null>('respond_game_invite', { p_invite: inv.id, p_accept: accept }); if (accept && gid) nav(`/game/${gid}`); else reload(); }
    catch (e) { fail(e); reload(); }
  };

  const modes = [
    { to: '/play/ai', icon: 'bot', title: t('play.ai.title'), desc: t('play.ai.desc') },
    { to: '/play/online', icon: 'globe', title: t('play.online.title'), desc: t('play.online.desc') },
    { to: '/play/room', icon: 'link', title: t('play.room.title'), desc: t('play.room.desc') },
    { to: '/watch', icon: 'eye', title: t('watch.title'), desc: t('watch.sub') },
    { to: '/play/local', icon: 'users', title: t('play.local.title'), desc: t('play.local.desc') },
  ];
  return (
    <div className="stack">
      <h1>{t('nav.play')}</h1>
      {invites.map((i) => (
        <div key={i.id} className="notice row between wrap">
          <span><strong>{i.from_name ?? '?'}</strong> {t('play.invitedYou')}</span>
          <span className="row"><button className="btn primary small" onClick={() => respond(i, true)}>{t('common.accept')}</button><button className="btn small" onClick={() => respond(i, false)}>{t('common.decline')}</button></span>
        </div>
      ))}
      {user && games.length > 0 && (
        <div className="card gold stack">
          <h3>{t('play.activeGames')}</h3>
          {games.map((g) => (
            <div key={g.id} className="row between">
              <span>{g.board_size}×{g.board_size} · {t(`status.${g.status}` as any)}</span>
              <Link className="btn primary small" to={`/game/${g.id}`}>{t('play.resume')}</Link>
            </div>
          ))}
        </div>
      )}
      <div className="grid two">
        {modes.map((m) => (
          <Link key={m.to} to={m.to} className="card" style={{ textDecoration: 'none' }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="avatar" style={{ background: 'var(--navy)', color: 'var(--on-navy)' }}><Icon name={m.icon} /></span>
              <div className="grow"><h3 style={{ marginBottom: 4 }}>{m.title}</h3><p className="muted small" style={{ margin: 0 }}>{m.desc}</p></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
