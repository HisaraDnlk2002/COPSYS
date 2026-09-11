import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { getAlerts, getMyAlerts } from "../../services/alerts";
import "./NotificationBell.css";

// duty_officer/inventory_officer both have read access to the
// station-wide Alerts tab (see inventoryRoutes.js/alertRoutes.js), so
// their bell reflects every open alert at the station, not just ones
// naming them personally — that's the whole point of the Inventory
// Officer's dashboard. A plain Officer has no such access; their bell
// is scoped to GET /alerts/mine, same as the My Weapons page.
const STATION_WIDE_ROLES = ["duty_officer", "inventory_officer"];
const ELIGIBLE_ROLES = ["officer", "duty_officer", "inventory_officer"];

const PRIORITY_DOT_CLASS = { critical: "notif-bell-dot-danger", warning: "notif-bell-dot-warning", info: "notif-bell-dot-info" };

// Sits in the shared topbar (DashboardLayout), so it mounts once per
// session rather than per page — there's no polling loop here (nothing
// else in this app polls either), so the count is as of last mount plus
// whenever the dropdown itself is opened, which re-fetches.
export function NotificationBell() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const stationWide = STATION_WIDE_ROLES.includes(user?.role);
  const eligible = ELIGIBLE_ROLES.includes(user?.role);

  // Memoized so this effect only re-runs when eligibility/scope actually
  // change, not on every render (a plain function here would be a new
  // reference each time, and satisfying exhaustive-deps with that would
  // mean re-fetching on every re-render instead of just on mount/role change).
  const load = useCallback(() => {
    const request = stationWide ? getAlerts() : getMyAlerts();
    request.then((res) => setAlerts(res || [])).catch((err) => console.error("Failed to load alerts:", err));
  }, [stationWide]);

  useEffect(() => {
    if (eligible) load();
  }, [eligible, load]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!eligible) return null;

  const openAlerts = alerts.filter((a) => a.status !== "resolved");
  const recent = openAlerts.slice(0, 6);

  function toggleOpen() {
    if (!open) load(); // refresh right before showing, rather than trusting a possibly-stale mount-time fetch
    setOpen((o) => !o);
  }

  function goToAlerts() {
    setOpen(false);
    navigate(stationWide ? "/inventory" : "/weapon-management");
  }

  return (
    <div className="notif-bell" ref={containerRef}>
      <button type="button" className="notif-bell-btn" onClick={toggleOpen} aria-label={t("notifications.title")}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {openAlerts.length > 0 && <span className="notif-bell-badge">{openAlerts.length > 9 ? "9+" : openAlerts.length}</span>}
      </button>

      {open && (
        <div className="notif-bell-dropdown">
          <div className="notif-bell-header">{t("notifications.title")}</div>
          {recent.length === 0 ? (
            <p className="notif-bell-empty">{t("notifications.empty")}</p>
          ) : (
            <ul className="notif-bell-list">
              {recent.map((a) => (
                <li key={a.id} className="notif-bell-item" onClick={goToAlerts}>
                  <span className={`notif-bell-dot ${PRIORITY_DOT_CLASS[a.priority] || ""}`} />
                  <div className="notif-bell-item-body">
                    <p className="notif-bell-item-title">{a.title}</p>
                    {(a.itemId?.itemId || a.itemId?.itemName) && (
                      <p className="notif-bell-item-meta">{a.itemId?.itemId || a.itemId?.itemName}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="notif-bell-viewall" onClick={goToAlerts}>
            {t("notifications.viewAll")}
          </button>
        </div>
      )}
    </div>
  );
}
