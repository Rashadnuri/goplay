import { Link, useNavigate } from 'react-router-dom';
import { Logo, Mountains, Sakura } from '../components/Deco.tsx';
import { Icon } from '../components/Icon.tsx';
import { LanguageSelect } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

export const ONBOARDED = 'goplay.onboarded';

/** First-run onboarding: scenery is built from SVG components, not an image. */
export default function Welcome() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const done = () => { try { localStorage.setItem(ONBOARDED, '1'); } catch { /* ignore */ } };
  return (
    <div className="splash">
      <div className="scene">
        <Mountains style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height: '62%' }} />
        <Sakura style={{ position: 'absolute', left: -10, top: -6, width: 'min(62vw, 260px)' }} />
        <div className="pattern" style={{ position: 'absolute', inset: 0, opacity: .6, maskImage: 'linear-gradient(180deg, transparent 55%, #000)', WebkitMaskImage: 'linear-gradient(180deg, transparent 55%, #000)' }} />
      </div>
      <div className="content">
        <div className="logo-wrap"><Logo size={170} /></div>
        <h1>GO PLAY</h1>
        <p className="tag">{t('app.tagline')}</p>
        <button className="btn primary" onClick={() => { done(); nav('/'); }}>{t('welcome.start')} <Icon name="arrow" size={20} /></button>
        <Link className="btn" to="/auth?mode=up" onClick={done}><Icon name="user" size={20} /> {t('common.signUp')}</Link>
        <Link className="btn" to="/auth" onClick={done}>{t('common.signIn')}</Link>
        <LanguageSelect value={lang} onChange={setLang} />
      </div>
    </div>
  );
}
