import { Logo } from './Deco.tsx';

export function LogoMark({ size = 34 }: { size?: number }) {
  return <Logo size={size} />;
}

export function Brand({ withTag = false }: { withTag?: boolean }) {
  return (
    <span className="brand">
      <LogoMark size={38} />
      <span>
        <span className="brand-name">GO PLAY</span>
        {withTag && <span className="brand-tag" style={{ display: 'block' }}>Play. Think. Compete.</span>}
      </span>
    </span>
  );
}
