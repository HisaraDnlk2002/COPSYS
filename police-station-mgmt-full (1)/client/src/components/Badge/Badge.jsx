import { useLanguage } from "../../i18n/useLanguage";
import "./Badge.css";


const STATUS_TONE = {
  confirmed: "success",
  approved: "success",
  active: "success",
  success: "success",
  open: "success",
  pending: "warning",
  investigating: "info",
  paused: "warning",
  disabled: "danger",
  rejected: "danger",
  failed: "danger",
  closed: "danger",
   complete: "success",
  archived: "neutral",

  // Inventory item/transaction vocabulary (Inventory + Weapon Management)
  available: "success",
  issued: "info",
  good: "success",
  damaged: "danger",
  faulty: "danger",
  missing: "danger",

  // Alerts module
  new: "danger",
  acknowledged: "warning",
  action_taken: "info",
  resolved: "success",
  critical: "danger",
  warning: "warning",
  info: "info",
};

export function Badge({ status, children, tone, title }) {
  const { t } = useLanguage();
  const key = (status || "").toLowerCase();
  const resolvedTone = tone || STATUS_TONE[key] || "neutral";
  // Fall back to the raw status word for anything not yet in the
  // dictionary, rather than showing the literal "status.xyz" lookup path.
  const translationKey = `status.${key}`;
  const translated = t(translationKey);
  const label = children || (translated === translationKey ? status : translated);
  return <span className={`badge badge-${resolvedTone}`} title={title}>{label}</span>;
}
