import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.tsx';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="empty stack">
      <h1>404</h1>
      <p>{t('common.notFound')}</p>
      <Link className="btn primary" to="/">{t('nav.home')}</Link>
    </div>
  );
}
