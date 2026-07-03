import "./Badge.css";

// Maps common status words to a visual tone automatically, so callers
// can just do <Badge status="approved" /> without picking colors.
const STATUS_TONE = {
  confirmed: "success",
  approved: "success",
  active: "success",
  open: "info",
  pending: "warning",
  investigating: "warning",
  disabled: "danger",
  rejected: "danger",
  closed: "neutral",
};

export function Badge({ status, children, tone }) {
  const resolvedTone = tone || STATUS_TONE[(status || "").toLowerCase()] || "neutral";
  return <span className={`badge badge-${resolvedTone}`}>{children || status}</span>;
}
