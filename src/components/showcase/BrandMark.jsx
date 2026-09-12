export function BrandMark({ className = "" }) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <rect x="7.4" y="7.4" width="25.2" height="25.2" rx="2.2" stroke="currentColor" strokeWidth="1.15" />
        <path d="M20 12.8v14.4" stroke="currentColor" strokeWidth="1.15" />
        <path d="M14.2 20h11.6" stroke="currentColor" strokeWidth="1.15" />
      </svg>
    </span>
  );
}
