import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, Seg, useToast } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { BOARD_THEMES, STONE_STYLES, usePrefs } from '../hooks/usePrefs.ts';
import { playStone } from '../lib/sound.ts';
import { fmtClock } from '../lib/clocks.ts';
import type { DictKey } from '../i18n/az.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { LANGS, useI18n } from '../i18n/index.tsx';
import { supabase } from '../lib/supabase.ts';

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const { prefs, set } = usePrefs();
  const { pref, set: setTheme } = useTheme();
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { toast, fail } = useToast();
  const [pw, setPw] = useState('');

  const saveProfile = async (patch: Record<string, unknown>) => {
    if (!supabase || !user) return;
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (error) fail(error); else { await refreshProfile(); }
  };
  const changePw = async () => {
    const { error } = await supabase!.auth.updateUser({ password: pw });
    if (error) fail(error); else { toast(t('settings.pwChanged')); setPw(''); }
  };

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>{t('settings.title')}</h1>
      <div className="card stack">
        <Field label={t('settings.language')}>
          <Seg value={lang} onChange={(l) => { setLang(l); void saveProfile({ language: l }); }} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
        </Field>
        <Field label={t('settings.theme')}>
          <Seg value={pref} onChange={(p) => { setTheme(p); void saveProfile({ theme: p }); }} options={[{ value: 'system', label: t('settings.themeSystem') }, { value: 'light', label: t('settings.themeLight') }, { value: 'dark', label: t('settings.themeDark') }]} />
        </Field>
      </div>
      <div className="card stack">
        <h3>{t('personal.board')}</h3>
        <Field label={t('personal.boardTheme')}>
          <div className="row wrap" role="group" aria-label={t('personal.boardTheme')}>
            {BOARD_THEMES.map((b) => (
              <button key={b} className="swatch" aria-pressed={prefs.boardTheme === b} onClick={() => set({ boardTheme: b })} title={t(`board.${b}` as DictKey)} aria-label={t(`board.${b}` as DictKey)}>
                <i style={{ background: { kaya: 'linear-gradient(135deg,#f6d38c,#d9a24d)', walnut: 'linear-gradient(135deg,#b98650,#7f5128)', cherry: 'linear-gradient(135deg,#eab08b,#bd7650)', bamboo: 'linear-gradient(135deg,#f0dfa0,#cdb263)', ebony: 'linear-gradient(135deg,#7a6244,#4e3b29)' }[b] }} />
              </button>
            ))}
          </div>
          <span className="small muted">{t(`board.${prefs.boardTheme}` as DictKey)}</span>
        </Field>
        <Field label={t('personal.stones')}>
          <Seg value={prefs.stoneStyle} onChange={(v) => set({ stoneStyle: v })} options={STONE_STYLES.map((x) => ({ value: x, label: t(`stones.${x}` as DictKey) }))} />
        </Field>
      </div>
      <div className="card stack">
        <h3>{t('personal.sound')}</h3>
        <label className="row"><input type="checkbox" checked={prefs.sound.on} onChange={(e) => set({ sound: { ...prefs.sound, on: e.target.checked } })} /> {t('personal.soundOn')}</label>
        <label className="row small muted">{t('personal.volume')} <input type="range" min={0} max={1} step={0.05} value={prefs.sound.volume} disabled={!prefs.sound.on} onChange={(e) => set({ sound: { ...prefs.sound, volume: Number(e.target.value) } })} style={{ flex: 1 }} /></label>
        <button className="btn small" disabled={!prefs.sound.on} onClick={() => playStone(prefs.sound.volume)}>{t('personal.testSound')}</button>
      </div>
      <div className="card stack">
        <h3>{t('personal.clocks')}</h3>
        <p className="small muted" style={{ margin: 0 }}>{t('personal.clocksHelp')}</p>
        {prefs.clocks.length === 0 && <div className="small muted">{t('personal.noClocks')}</div>}
        {prefs.clocks.map((c, i) => <div key={i} className="row between"><strong>{fmtClock(c.initial, c.increment)}</strong><button className="btn small danger" onClick={() => set({ clocks: prefs.clocks.filter((_, j) => j !== i) })}>{t('common.delete')}</button></div>)}
      </div>
      <div className="card stack">
        <h3>{t('settings.board')}</h3>
        <label className="row"><input type="checkbox" checked={prefs.coords} onChange={(e) => set({ coords: e.target.checked })} /> {t('settings.coords')}</label>
        <Field label={t('settings.confirmMoves')} hint={t('settings.confirmHelp')}>
          <Seg value={prefs.confirmMoves} onChange={(v) => set({ confirmMoves: v })} options={[{ value: 'auto', label: t('settings.auto') }, { value: 'on', label: t('settings.on') }, { value: 'off', label: t('settings.off') }]} />
        </Field>
      </div>
      {profile && (
        <div className="card stack">
          <h3>{t('settings.privacy')}</h3>
          <label className="row"><input type="checkbox" checked={profile.show_online} onChange={(e) => saveProfile({ show_online: e.target.checked })} /> {t('settings.showOnline')}</label>
          <Field label={t('settings.newPassword')}>
            <div className="row"><input className="input" aria-label={t('settings.newPassword')} type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><button className="btn" disabled={pw.length < 8} onClick={changePw}>{t('common.save')}</button></div>
          </Field>
          <button className="btn danger" onClick={signOut}>{t('common.signOut')}</button>
        </div>
      )}
      {!user && <Link className="btn primary" to="/auth">{t('common.signIn')}</Link>}
    </div>
  );
}
