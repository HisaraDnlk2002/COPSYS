import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, Table, Badge, Loader, Modal, Pagination } from "../../components";
import { getNotificationFeed, updateAlertStatus } from "../../services/alerts";
import { openNotificationStream } from "../../services/notificationStream";
import { formatDate } from "../../utils/formatDate";
import "./Notifications.css";

// Where alerts come from — mirrors ALERT_SOURCE_BY_TYPE in
// server/src/models/Alert.js (the server tags every alert with one).
const SOURCES = ["inventory", "leave", "duty", "complaints"];
const SOURCE_TONE = { inventory: "info", leave: "success", duty: "neutral", complaints: "danger" };

const PRIORITY_TONE = { critical: "danger", warning: "warning", info: "info" };
const PRIORITY_LABEL_KEY = { critical: "priorityCritical", warning: "priorityWarning", info: "priorityInfo" };
const STATUS_LABEL_KEY = { new: "statusNew", acknowledged: "statusAcknowledged", action_taken: "statusActionTaken", resolved: "statusResolved" };
// The one step forward from each status: New -> Acknowledged -> Action Taken -> Resolved.
const NEXT_STATUS = { new: "acknowledged", acknowledged: "action_taken", action_taken: "resolved" };
const ACTION_LABEL_KEY = { acknowledged: "acknowledge", action_taken: "markActionTaken", resolved: "resolve" };

// Roles whose feed includes other people's alerts, so the "Recipient"
// column is worth showing (see feed() in alertsController.js).
const STATION_VIEW_ROLES = ["oic", "inventory_officer", "duty_officer"];

const PAGE_SIZE = 15;

// Alerts are precise moments, so show them in the viewer's local time.
function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${formatDate(value)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The page each source's alerts relate to, for the "Open" button.
function relatedPath(source, role) {
  if (source === "inventory") return ["inventory_officer", "duty_officer", "oic"].includes(role) ? "/inventory" : "/weapon-management";
  if (source === "leave") return "/leave";
  if (source === "duty") return ["oic", "duty_officer"].includes(role) ? "/duty-roster" : "/dashboard";
  if (source === "complaints") return "/complaints";
  return null;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  // The bell can open this page pre-filtered to one source.
  const [source, setSource] = useState(SOURCES.includes(location.state?.source) ? location.state.source : "all");
  const [priority, setPriority] = useState("all");
  const [status, setStatus] = useState("open"); // "open" hides resolved ones by default
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [actingAlert, setActingAlert] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(() => {
    return getNotificationFeed()
      .then((res) => setAlerts(res || []))
      .catch((err) => console.error("Failed to load notifications:", err));
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Live updates: the server pushes an event whenever an alert is raised
  // for this user (same stream the bell listens to), so reload then.
  useEffect(() => {
    const stream = openNotificationStream();
    if (!stream) return;
    stream.onmessage = () => load();
    return () => stream.close();
  }, [load]);

  function changeFilter(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }

  function canAct(row) {
    if (!NEXT_STATUS[row.status]) return false;
    if (user?.role === "oic") return true;
    if (user?.role === "inventory_officer" && row.source === "inventory") return true;
    const recipientId = row.recipientId?._id || row.recipientId?.id;
    return Boolean(recipientId) && String(recipientId) === String(user?.id);
  }

  function openAction(row) {
    setActingAlert(row);
    setRemarks(row.remarks || "");
    setActionError("");
  }

  function closeAction() {
    setActingAlert(null);
    setRemarks("");
    setActionError("");
  }

  async function handleAction() {
    setSubmitting(true);
    setActionError("");
    try {
      await updateAlertStatus(actingAlert.id, NEXT_STATUS[actingAlert.status], remarks);
      await load();
      closeAction();
    } catch (err) {
      setActionError(err.message || t("notifications.errUpdateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loader label={t("notifications.loading")} />;

  const openAlerts = alerts.filter((a) => a.status !== "resolved");
  // Tab counts are open alerts per source, so a tab with work waiting stands out.
  const openCountBySource = SOURCES.reduce((acc, s) => {
    acc[s] = openAlerts.filter((a) => a.source === s).length;
    return acc;
  }, {});
  const criticalOpen = openAlerts.filter((a) => a.priority === "critical").length;

  const q = search.trim().toLowerCase();
  const filtered = alerts.filter((a) => {
    if (source !== "all" && a.source !== source) return false;
    if (priority !== "all" && a.priority !== priority) return false;
    if (status === "open" && a.status === "resolved") return false;
    if (status !== "open" && status !== "all" && a.status !== status) return false;
    if (!q) return true;
    return (
      a.title?.toLowerCase().includes(q) ||
      a.message?.toLowerCase().includes(q) ||
      a.refId?.toLowerCase().includes(q) ||
      a.itemId?.itemId?.toLowerCase().includes(q) ||
      a.recipientId?.fullName?.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const filtersActive = source !== "all" || priority !== "all" || status !== "open" || Boolean(q);

  const columns = [
    { key: "generatedAt", label: t("notifications.colDate"), render: (row) => formatDateTime(row.generatedAt) },
    {
      key: "source",
      label: t("notifications.colSource"),
      render: (row) => <Badge tone={SOURCE_TONE[row.source] || "neutral"}>{t(`notifications.source_${row.source}`)}</Badge>,
    },
    {
      key: "priority",
      label: t("notifications.colPriority"),
      render: (row) => <Badge tone={PRIORITY_TONE[row.priority]}>{t(`notifications.${PRIORITY_LABEL_KEY[row.priority]}`)}</Badge>,
    },
    {
      key: "title",
      label: t("notifications.colNotification"),
      render: (row) => (
        <div className="notif-page-title-cell">
          <span className="notif-page-title">{row.title}</span>
          {row.message && <span className="notif-page-message">{row.message}</span>}
        </div>
      ),
    },
    ...(STATION_VIEW_ROLES.includes(user?.role)
      ? [{ key: "recipientId", label: t("notifications.colRecipient"), render: (row) => row.recipientId?.fullName || "—" }]
      : []),
    {
      key: "status",
      label: t("common.status"),
      render: (row) => <Badge status={row.status}>{t(`notifications.${STATUS_LABEL_KEY[row.status]}`)}</Badge>,
    },
    {
      key: "actions",
      label: "",
      render: (row) => {
        const path = relatedPath(row.source, user?.role);
        return (
          <div className="notif-page-actions">
            {canAct(row) && (
              <Button variant="ghost" onClick={() => openAction(row)}>
                {t(`notifications.${ACTION_LABEL_KEY[NEXT_STATUS[row.status]]}`)}
              </Button>
            )}
            {path && (
              <Button variant="outline" onClick={() => navigate(path)}>
                {t("notifications.open")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <div className="notif-page-header">
        <div>
          <h1>{t("notifications.title")}</h1>
          <p className="notif-page-subtitle">{t("notifications.subtitle")}</p>
        </div>
        <div className="notif-page-stats">
          <span className="notif-page-stat notif-page-stat-danger">
            {criticalOpen} {t("notifications.criticalOpen")}
          </span>
          <span className="notif-page-stat notif-page-stat-warning">
            {openAlerts.length} {t("notifications.open_count")}
          </span>
        </div>
      </div>

      <div className="notif-page-tabs" role="tablist">
        {["all", ...SOURCES].map((s) => {
          const count = s === "all" ? openAlerts.length : openCountBySource[s];
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={source === s}
              className={`notif-page-tab${source === s ? " active" : ""}`}
              onClick={() => changeFilter(setSource)(s)}
            >
              {t(`notifications.source_${s}`)}
              {count > 0 && <span className="notif-page-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <Card variant="panel">
        <div className="notif-page-filters">
          <div className="notif-page-search">
            <InputField
              label={t("notifications.search")}
              placeholder={t("notifications.searchPlaceholder")}
              value={search}
              onChange={(e) => changeFilter(setSearch)(e.target.value)}
            />
          </div>
          <InputField
            label={t("notifications.colPriority")}
            type="select"
            value={priority}
            onChange={(e) => changeFilter(setPriority)(e.target.value)}
            options={[
              { value: "all", label: t("notifications.allPriorities") },
              { value: "critical", label: t("notifications.priorityCritical") },
              { value: "warning", label: t("notifications.priorityWarning") },
              { value: "info", label: t("notifications.priorityInfo") },
            ]}
          />
          <InputField
            label={t("common.status")}
            type="select"
            value={status}
            onChange={(e) => changeFilter(setStatus)(e.target.value)}
            options={[
              { value: "open", label: t("notifications.statusOpenOnly") },
              { value: "all", label: t("notifications.allStatuses") },
              { value: "new", label: t("notifications.statusNew") },
              { value: "acknowledged", label: t("notifications.statusAcknowledged") },
              { value: "action_taken", label: t("notifications.statusActionTaken") },
              { value: "resolved", label: t("notifications.statusResolved") },
            ]}
          />
          {filtersActive && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setSource("all");
                setPriority("all");
                setStatus("open");
                setSearch("");
                setPage(1);
              }}
            >
              {t("notifications.clearFilters")}
            </Button>
          )}
        </div>

        <Table columns={columns} data={pageItems} emptyMessage={t("notifications.noMatches")} />
        <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      <Modal
        open={Boolean(actingAlert)}
        onClose={closeAction}
        title={actingAlert ? `${actingAlert.title} — ${actingAlert.refId}` : ""}
        footer={
          actingAlert &&
          NEXT_STATUS[actingAlert.status] && (
            <Button variant="primary" fullWidth onClick={handleAction} disabled={submitting}>
              {submitting ? t("notifications.saving") : t(`notifications.${ACTION_LABEL_KEY[NEXT_STATUS[actingAlert.status]]}`)}
            </Button>
          )
        }
      >
        {actingAlert && (
          <div className="notif-page-summary">
            <p>
              <strong>{t("notifications.colSource")}:</strong> {t(`notifications.source_${actingAlert.source}`)}
            </p>
            {actingAlert.message && (
              <p>
                <strong>{t("notifications.colMessage")}:</strong> {actingAlert.message}
              </p>
            )}
            {(actingAlert.itemId?.itemId || actingAlert.itemId?.itemName) && (
              <p>
                <strong>{t("notifications.colItem")}:</strong> {actingAlert.itemId?.itemId || actingAlert.itemId?.itemName}
              </p>
            )}
            <p>
              <strong>{t("notifications.colDate")}:</strong> {formatDateTime(actingAlert.generatedAt)}
            </p>
          </div>
        )}
        <InputField
          label={t("notifications.remarks")}
          type="textarea"
          rows={3}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          voiceInput
          sinhalaTyping
        />
        {actionError && <p className="notif-page-error">{actionError}</p>}
      </Modal>
    </div>
  );
}
