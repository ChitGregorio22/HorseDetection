import logo from '../../assets/horse-logo.png';
import logoWhite from '../../assets/horse-logo-white.png';

/** Our logo (Wranggler Thermal). white = for dark backgrounds. */
export function LogoMark({ className = '', white = false, alt = 'Wranggler Thermal logo' }: { className?: string; white?: boolean; alt?: string }) {
  return <img src={white ? logoWhite : logo} alt={alt} draggable={false} className={`select-none object-contain ${className}`} />;
}

/** Placeholder where a horse photo is missing (was the 🐎 emoji) */
export function NoPhoto({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <LogoMark alt="" className="h-3/5 max-h-28 w-3/5 max-w-28 opacity-25" />
    </div>
  );
}
