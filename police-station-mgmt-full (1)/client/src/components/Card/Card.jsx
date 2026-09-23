import "./Card.css";

// variant: "stat" (small dashboard tile like "Today's Duty"),
//          "panel" (large bordered container like "Weekly Duty Schedule")
//
// `style` was accepted at dozens of call sites across the app (spacing
// tweaks like marginTop, width overrides, ...) but never actually
// forwarded to the rendered div — every one of those inline styles was
// silently a no-op. Whatever spacing those pages actually showed came
// from .card's own CSS or a parent's layout, never from the style prop
// itself.
export function Card({ children, variant = "panel", muted = false, className = "", style }) {
  return (
    <div
      className={`card card-${variant}${muted ? " card-muted" : ""} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

// Convenience sub-component matching the dashboard stat cards exactly:
// small label on top, big value, small caption below.
// e.g. <StatCard label="Leave Status" value="12 Days" caption="Available Balance" />
export function StatCard({ label, value, caption }) {
  return (
    <Card variant="stat" muted>
      <p className="stat-card-label">{label}</p>
      <p className="stat-card-value">{value}</p>
      {caption && <p className="stat-card-caption">{caption}</p>}
    </Card>
  );
}
