import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'activity'
  | 'alert'
  | 'audio'
  | 'check'
  | 'chevron-right'
  | 'cpu'
  | 'convert'
  | 'download'
  | 'external'
  | 'file-text'
  | 'folder'
  | 'green-screen'
  | 'grid'
  | 'inbox'
  | 'layers'
  | 'list'
  | 'log-out'
  | 'memory'
  | 'merge'
  | 'palette'
  | 'play'
  | 'refresh'
  | 'render'
  | 'repeat'
  | 'scissors'
  | 'settings'
  | 'shield'
  | 'shuffle'
  | 'sparkles'
  | 'stop'
  | 'trash'
  | 'trim'
  | 'upload'
  | 'user'
  | 'volume-off'
  | 'x'

const CONTENT: Record<IconName, ReactNode> = {
  activity: <path d="M3 12h4l2.2-6 4.2 12 2.2-6H21" />,
  alert: (
    <>
      <path d="M10.3 3.7 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  audio: (
    <>
      <path d="M3 12h2l1.5-5 3 10 3-13 3 16 2.5-8H21" />
      <path d="M4 20h16" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  cpu: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3M10 10h4v4h-4z" />
    </>
  ),
  convert: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h9m-3-3 3 3-3 3M17 15H8m3-3-3 3 3 3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  'file-text': (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h8" />
    </>
  ),
  folder: (
    <>
      <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2Z" />
      <path d="M3 9h18" />
    </>
  ),
  'green-screen': (
    <>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="m8 10 2.2 2.2L16 7" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 4h16l2 10v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5Z" />
      <path d="M2 14h5l2 3h6l2-3h5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="3" />
    </>
  ),
  'log-out': (
    <>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </>
  ),
  memory: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h3v4H7zM14 10h3v4h-3zM7 3v3M12 3v3M17 3v3M7 18v3M12 18v3M17 18v3" />
    </>
  ),
  merge: (
    <>
      <path d="M6 3v4c0 3 2 5 5 5h7" />
      <path d="m15 9 3 3-3 3" />
      <path d="M6 21v-4c0-3 2-5 5-5" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1.4a1.8 1.8 0 0 0 1.2-3.1 1.8 1.8 0 0 1 1.2-3.1H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z" />
      <path d="M7.5 10h.01M9.5 6.5h.01M14 6.5h.01M17 9h.01" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7Z" />,
  refresh: (
    <>
      <path d="M20 7h-5V2" />
      <path d="M20 7a9 9 0 1 0 1 9" />
    </>
  ),
  render: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" />
      <path d="m10 9 5 3-5 3Z" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="7" r="3" />
      <circle cx="6" cy="17" r="3" />
      <path d="m8.6 8.5 11.8 7M8.6 15.5 20.4 8.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  shuffle: (
    <>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="m15 15 6 6M4 4l5 5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3Z" />
      <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" />
    </>
  ),
  stop: (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V3h8v3M19 6l-1 15H6L5 6M10 11v6M14 11v6" />
    </>
  ),
  trim: (
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
      <path d="m8 10 8 4M16 10l-8 4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 21V9" />
      <path d="m7 14 5-5 5 5" />
      <path d="M5 3h14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  'volume-off': (
    <>
      <path d="M11 5 6 9H2v6h4l5 4Z" />
      <path d="m16 9 6 6M22 9l-6 6" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {CONTENT[name]}
    </svg>
  )
}
