// The app's one icon set: 24×24 stroke icons drawn in currentColor.
// Use these instead of text glyphs (✕ ✓ ▶) or emoji. Add new paths here.
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  restart: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  stop: 'M7 7h10v10H7z',
  backup: 'M4 7h16v4H4zM6 11v9h12v-9M10 15h4',
  folder: 'M3 6h6l2 2h10v11H3z',
  logs: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  settings: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  upload: 'M12 19V5M5 12l7-7 7 7',
  download: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  user: 'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  userPlus: 'M15 19v-1a4 4 0 0 0-8 0v1M11 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M22 11h-6',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  back: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7M8 21v-7h8v7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  play: 'M7 4l13 8-13 8z',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronsLeft: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  chevronsRight: 'M13 17l5-5-5-5M6 17l5-5-5-5',
  file: 'M14 3H6v18h12V7l-4-4zM14 3v4h4',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
} as const;

export type IconName = keyof typeof PATHS;

// Sized 1em by default so a bare icon matches the text around it; CSS (e.g. `.btn svg`) can override
export function Icon(props: { name: IconName; class?: string }) {
  return (
    <svg
      class={props.class ? `icon ${props.class}` : 'icon'}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}
