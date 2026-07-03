import "./Card.css";

// variant: "stat" (small dashboard tile like "Today's Duty"),
//          "panel" (large bordered container like "Weekly Duty Schedule")
export function Card({ children, variant = "panel", muted = false, className = "" }) {
  return (
    <div
      className={`card card-${variant}${muted ? " card-muted" : ""} ${className}`}
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
