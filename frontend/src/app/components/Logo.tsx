// DataMigrationTool mark: a source database (outlined) feeding a target
// database (solid) through an arrow -- data moving from one place to another.
// The same artwork lives in src/app/icon.svg for the browser tab.

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="DataMigrationTool"
    >
      <rect width="48" height="48" rx="11" fill="var(--primary)" />
      {/* source database */}
      <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="14" rx="6.5" ry="2.8" />
        <path d="M5.5 14v19c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8V14" />
        <path d="M5.5 23.5c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8" />
      </g>
      {/* target database */}
      <ellipse cx="36" cy="14" rx="6.5" ry="2.8" fill="#fff" />
      <path
        d="M29.5 16.2v16.8c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8V16.2c0 1.5-2.9 2.8-6.5 2.8s-6.5-1.3-6.5-2.8z"
        fill="#fff"
      />
      <path d="M29.5 24.5c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8" fill="none" stroke="var(--primary)" strokeWidth="1.6" />
      {/* the migration */}
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.5 24.5h7.5" />
        <path d="M25 21l3.5 3.5L25 28" />
      </g>
    </svg>
  );
}
