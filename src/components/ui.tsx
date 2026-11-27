import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useId, useState, type ReactElement, type ReactNode } from 'react';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { errorCode } from '../lib/supabase.ts';
import type { Lang } from '../lib/types.ts';

/* ── toasts ── */
interface Toast { id: number; msg: string; kind: 'info' | 'error' }
const ToastCtx = createContext<{ toast: (msg: string, kind?: 'info' | 'error') => void; fail: (e: unknown) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
  }, []);
  const fail = useCallback(
    (e: unknown) => {
      const code = errorCode(e);
      const key = `err.${code}` as DictKey;
      const msg = t(key) === key ? t('err.unknown') : t(key);
      toast(msg, 'error');
    },
    [t, toast],
  );
  return (
    <ToastCtx.Provider value={{ toast, fail }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>{i.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast outside provider');
  return c;
};

/* ── modal ── */
export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="stack">{children}</div>
        {actions && <div className="row wrap" style={{ marginTop: 16, justifyContent: 'flex-end' }}>{actions}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirmLabel, danger, onConfirm, onClose }: { title: string; body?: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => { onClose(); onConfirm(); }}>{confirmLabel}</button>
        </>
      }
    >
      {body && <p className="muted" style={{ margin: 0 }}>{body}</p>}
    </Modal>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status" style={{ justifyContent: 'center', gap: 10 }}>
      <span className="spinner" />
      {label && <span className="muted">{label}</span>}
    </span>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <div className="empty"><Spinner label={t('common.loading')} /></div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const code = errorCode(error);
  const key = `err.${code}` as DictKey;
  const msg = t(key) === key ? t('err.unknown') : t(key);
  return (
    <div className="notice error stack" role="alert">
      <span>{msg}</span>
      {onRetry && <button className="btn small" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  );
}

const AVATARS: Record<string, string> = {
  'stone-black': '#1d2230', 'stone-white': '#8a8576', wood: '#a9763a', gold: '#b8924a', navy: '#2d3a5e', jade: '#3a7d68',
  crimson: '#9b3b3b', sky: '#4a7fb0', plum: '#6d4a7a', sand: '#b09a6e', forest: '#456b45', slate: '#5c6575',
};
export const AVATAR_KEYS = Object.keys(AVATARS);

export function Avatar({ name, avatar, size }: { name: string; avatar?: string; size?: 'sm' | 'lg' }) {
  const bg = AVATARS[avatar ?? ''] ?? AVATARS['stone-black'];
  return (
    <span className={`avatar ${size ?? ''}`} style={{ background: bg }} aria-hidden="true">
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function LeagueBadge({ league }: { league: string }) {
  const { t } = useI18n();
  return (
    <span className={`league ${league}`}>
      <i />
      {t(`league.${league}` as DictKey)}
    </span>
  );
}

export function StoneDot({ color }: { color: 1 | 2 }) {
  return <span className={`stone-sm ${color === 1 ? 'b' : 'w'}`} />;
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Label + control. The label is always programmatically tied to the control (id/htmlFor, or aria-label for segmented controls). */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  let labelled = false;
  const wired = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const el = child as ReactElement<{ id?: string; label?: string; 'aria-describedby'?: string }>;
    if (typeof el.type === 'string' && ['input', 'select', 'textarea'].includes(el.type) && !labelled) {
      labelled = true;
      return cloneElement(el, { id: el.props.id ?? id, 'aria-describedby': hint ? `${id}-hint` : undefined });
    }
    if (el.type === Seg && !el.props.label) { labelled = true; return cloneElement(el, { label }); }
    return child;
  });
  return (
    <div className="field">
      {labelled ? <label htmlFor={id} id={`${id}-l`}>{label}</label> : <span className="label" id={`${id}-l`}>{label}</span>}
      {wired}
      {hint && <span className="small muted" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

export function LanguageSelect({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as Lang)} aria-label="Language" style={{ width: 'auto', minHeight: 40, paddingBlock: 6 }}>
      <option value="ru">RU</option>
      <option value="en">EN</option>
      <option value="az">AZ</option>
    </select>
  );
}

export function BackendNotice() {
  const { t } = useI18n();
  return (
    <div className="notice stack">
      <strong>{t('backend.title')}</strong>
      <span>{t('backend.body')}</span>
    </div>
  );
}
