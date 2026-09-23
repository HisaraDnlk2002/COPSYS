// Small line icons for the sidebar nav — one per navConfig.js `key`.
// Matches the inline-SVG convention already used elsewhere in the app
// (InputField's mic button): stroke=currentColor,
// no fill, so each icon just picks up whatever color .sidebar-link's
// hover/active state sets rather than needing its own color prop.
const ICONS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  personnel: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" strokeLinecap="round" />
    </>
  ),
  leave: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" strokeLinecap="round" />
      <line x1="16" y1="3" x2="16" y2="7" strokeLinecap="round" />
    </>
  ),
  complaints: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1.5" />
      <line x1="9" y1="8" x2="15" y2="8" strokeLinecap="round" />
      <line x1="9" y1="12" x2="15" y2="12" strokeLinecap="round" />
      <line x1="9" y1="16" x2="13" y2="16" strokeLinecap="round" />
    </>
  ),
  reports: (
    <>
      <rect x="4" y="13" width="4" height="8" rx="0.5" />
      <rect x="10" y="8" width="4" height="13" rx="0.5" />
      <rect x="16" y="4" width="4" height="17" rx="0.5" />
    </>
  ),
  "audit-log": (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="12" x2="12" y2="7" strokeLinecap="round" />
      <line x1="12" y1="12" x2="15.5" y2="13.5" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" strokeLinecap="round" />
      <circle cx="9" cy="7" r="2" />
      <line x1="4" y1="13" x2="20" y2="13" strokeLinecap="round" />
      <circle cx="16" cy="13" r="2" />
      <line x1="4" y1="19" x2="20" y2="19" strokeLinecap="round" />
      <circle cx="11" cy="19" r="2" />
    </>
  ),
  "duty-roster": (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="3" rx="1" />
      <path d="M8.5 13l2 2 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "weapon-management": (
    <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z" strokeLinejoin="round" />
  ),
  inventory: (
    <>
      <rect x="4" y="7" width="16" height="13" rx="1.5" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" />
    </>
  ),
};

// Renders nothing (rather than a broken/empty icon) for a key that isn't
// in the map above — e.g. if a future nav item is added to navConfig.js
// before a matching icon is drawn for it, the label still shows fine on
// its own.
export function NavIcon({ navKey }) {
  const shape = ICONS[navKey];
  if (!shape) return null;
  return (
    <svg
      className="sidebar-link-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}
