import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { BackendNotice, Field, Loading, Seg, useToast } from '../components/ui.tsx';
import { LogoMark } from '../components/Logo.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { AppError, backendReady, errorCode, supabase } from '../lib/supabase.ts';

export default function AuthPage() {
  const { t, lang } = useI18n();
  const { user, loading } = useAuth();
  const { fail, toast } = useToast();
  const [params] = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>(params.get('mode') === 'up' ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  if (!backendReady) return <div className="stack"><h1>{t('common.signIn')}</h1><BackendNotice /></div>;
  if (loading) return <Loading />;
  if (user) return <Navigate to={safeNext} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setInfo(null);
    try {
      if (mode === 'reset') {
        const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/settings` });
        if (error) throw error;
        setInfo(t('auth.resetSent'));
      } else if (mode === 'in') {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw new AppError(/Invalid login/i.test(error.message) ? 'invalid_credentials' : /confirm/i.test(error.message) ? 'email_not_confirmed' : errorCode(error));
      } else {
        if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new AppError('invalid_username');
        if (password.length < 8) throw new AppError('weak_password');
        const { data, error } = await supabase!.auth.signUp({ email, password, options: { data: { username, language: lang }, emailRedirectTo: `${location.origin}${safeNext}` } });
        if (error) throw new AppError(/registered/i.test(error.message) ? 'email_taken' : errorCode(error));
        if (!data.session) setInfo(t('auth.checkEmail'));
        else toast(t('auth.welcome'));
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ maxWidth: 420, margin: '0 auto' }}>
      <div className="center"><LogoMark size={64} /></div>
      <h1 className="center">{mode === 'up' ? t('auth.createAccount') : mode === 'reset' ? t('auth.reset') : t('common.signIn')}</h1>
      {mode !== 'reset' && <div className="center"><Seg value={mode} onChange={setMode} options={[{ value: 'in', label: t('common.signIn') }, { value: 'up', label: t('common.signUp') }]} /></div>}
      <form className="card stack" onSubmit={submit}>
        {mode === 'up' && <Field label={t('auth.username')} hint={t('auth.usernameHint')}><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" /></Field>}
        <Field label={t('auth.email')}><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
        {mode !== 'reset' && <Field label={t('auth.password')}><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={mode === 'up' ? 8 : 1} /></Field>}
        {info && <div className="notice" role="status">{info}</div>}
        <button className="btn primary block" disabled={busy}>{mode === 'up' ? t('common.signUp') : mode === 'reset' ? t('auth.sendReset') : t('common.signIn')}</button>
        {mode === 'in' && <button type="button" className="btn ghost small" onClick={() => setMode('reset')}>{t('auth.forgot')}</button>}
        {mode === 'reset' && <button type="button" className="btn ghost small" onClick={() => setMode('in')}>{t('common.back')}</button>}
      </form>
      <p className="center small muted"><Link to="/">{t('auth.continueGuest')}</Link></p>
    </div>
  );
}
