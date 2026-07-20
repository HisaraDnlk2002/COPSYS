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
};

export function Badge({ status, children, tone }) {
  const { t } = useLanguage();
  const key = (status || "").toLowerCase();
  const resolvedTone = tone || STATUS_TONE[key] || "neutral";
  // Fall back to the raw status word for anything not yet in the
  // dictionary, rather than showing the literal "status.xyz" lookup path.
  const translationKey = `status.${key}`;
  const translated = t(translationKey);
  const label = children || (translated === translationKey ? status : translated);
  return <span className={`badge badge-${resolvedTone}`}>{label}</span>;
}
