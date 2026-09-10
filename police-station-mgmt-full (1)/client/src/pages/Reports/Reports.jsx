import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Button, Card, StatCard, Table, Loader, InputField, Badge, SearchableSelect } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import { useAuth } from "../../auth/useAuth";
import { searchOfficers } from "../../services/officers";
import {
  getReportsSummary,
  getCrimeDistribution,
  getForceStrength,
  getActivityLog,
  previewReport,
  generateReport,
  downloadReport,
  archiveReport,
  deleteReport,
} from "../../services/reports";
import "./Reports.css";

const PAGE_SIZE = 10;

// Roles that see the station-wide Overview (stat cards + charts) and every
// report category. Every other role only ever sees the categories listed
// against it in CATEGORY_DEFS below, and lands straight in its workbench
// instead of an empty hub. Kept in sync by hand with the server's own
// CATEGORY_ROLES in reportsController.js — that copy is what's actually
// enforced; this one only decides what the sidebar offers.
const OVERVIEW_ROLES = ["admin", "oic"];

// Maps a ReportExport `type` (including "inventory", the pre-split legacy
// name for "weapons") to the translation key for its category label —
// used for the "Type" column on the hub's all-categories ledger.
const CATEGORY_LABEL_KEY = {
  duty: "catDutyTitle",
  officers: "catOfficersTitle",
  leave: "catLeaveTitle",
  crime: "catCrimeTitle",
  weapons: "catWeaponsTitle",
  inventory: "catWeaponsTitle",
  ammunition: "catAmmunitionTitle",
  station: "catStationTitle",
};

function categoryLabelFor(type, t) {
  const key = CATEGORY_LABEL_KEY[type];
  return key ? t(`reports.${key}`) : type;
}

// yyyy-mm-dd for date inputs / API payloads
function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

const PRESETS = [
  {
    key: "today",
    labelKey: "reports.presetToday",
    range: () => {
      const today = new Date();
      return { dateFrom: toDateInput(today), dateTo: toDateInput(today) };
    },
  },
  {
    key: "thisWeek",
    labelKey: "reports.presetThisWeek",
    range: () => ({ dateFrom: toDateInput(startOfWeek(new Date())), dateTo: toDateInput(new Date()) }),
  },
  {
    key: "thisMonth",
    labelKey: "reports.presetThisMonth",
    range: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: toDateInput(first), dateTo: toDateInput(now) };
    },
  },
  {
    key: "lastWeek",
    labelKey: "reports.presetLastWeek",
    range: () => {
      const thisMonday = startOfWeek(new Date());
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(lastMonday.getDate() - 7);
      const lastSunday = new Date(thisMonday);
      lastSunday.setDate(lastSunday.getDate() - 1);
      return { dateFrom: toDateInput(lastMonday), dateTo: toDateInput(lastSunday) };
    },
  },
  {
    key: "lastMonth",
    labelKey: "reports.presetLastMonth",
    range: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: toDateInput(first), dateTo: toDateInput(last) };
    },
  },
  { key: "custom", labelKey: "reports.presetCustom", range: null },
];

// Strips the "all"/"no filter" sentinel (and empty text fields) out of
// the filters state before it's sent to the API — the server treats a
// missing key as "don't filter on this", not the literal string "all".
function buildFilterPayload(filters) {
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all") clean[key] = value;
  }
  return clean;
}

function defaultRange() {
  const now = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { dateFrom: toDateInput(from), dateTo: toDateInput(now) };
}

// Declared at module scope (not inside ReportsPage's render) so it isn't
// re-created — and its internal state reset — on every render.
function PaginationBar({ activityMeta, activityLoading, onPageChange, t }) {
  if (activityMeta.totalPages <= 1) return null;
  return (
    <div className="reports-pagination">
      <Button
        variant="outline"
        disabled={activityLoading || activityMeta.page <= 1}
        onClick={() => onPageChange(activityMeta.page - 1)}
      >
        {t("reports.prevPage")}
      </Button>
      <span className="reports-pagination-label">
        {t("reports.pageOf").replace("{page}", activityMeta.page).replace("{total}", activityMeta.totalPages)}
      </span>
      <Button
        variant="outline"
        disabled={activityLoading || activityMeta.page >= activityMeta.totalPages}
        onClick={() => onPageChange(activityMeta.page + 1)}
      >
        {t("reports.nextPage")}
      </Button>
    </div>
  );
}

// Same list Complaints.jsx offers on the registration form — duplicated
// (rather than imported) since that file doesn't export it, but the
// values and translation keys are identical so the filter stays in sync
// with what a complaint can actually be categorized as.
function complaintCategoryOptions(t) {
  return [
    { value: "Theft", label: t("complaints.categoryTheft") },
    { value: "Assault", label: t("complaints.categoryAssault") },
    { value: "Residential Burglary", label: t("complaints.categoryResidentialBurglary") },
    { value: "Vehicle Theft", label: t("complaints.categoryVehicleTheft") },
    { value: "Public Disturbance", label: t("complaints.categoryPublicDisturbance") },
    { value: "Public Nuisance", label: t("complaints.categoryPublicNuisance") },
    { value: "Traffic", label: t("complaints.categoryTraffic") },
    { value: "Missing Person", label: t("complaints.categoryMissingPerson") },
    { value: "Other", label: t("complaints.categoryOther") },
  ];
}

// The extra, per-category picklist filters shown under "Filters" on the
// workbench — kind "officer" renders a SearchableSelect (backed by the
// same /officers/search endpoint used elsewhere in the app), "select"
// renders a plain dropdown, "text" a free-text substring field. Must stay
// in sync with FILTER_KEYS_BY_TYPE on the server (reportsController.js) —
// a key sent here that the server doesn't whitelist for this type is
// silently dropped there, not rejected.
function getFilterFields(type, t) {
  switch (type) {
    case "duty":
      return [
        { key: "officerId", kind: "officer", label: t("reports.filterOfficer") },
        {
          key: "shiftType",
          kind: "select",
          label: t("reports.filterShift"),
          options: [
            { value: "day", label: t("status.day") },
            { value: "night", label: t("status.night") },
          ],
        },
        { key: "department", kind: "text", label: t("reports.filterDepartment"), placeholder: t("reports.filterDepartmentPlaceholder") },
      ];
    case "officers":
      return [
        {
          key: "role",
          kind: "select",
          label: t("reports.filterRole"),
          options: [
            { value: "admin", label: t("personnel.roleAdmin") },
            { value: "oic", label: t("personnel.roleOic") },
            { value: "duty_officer", label: t("personnel.roleDutyOfficer") },
            { value: "inventory_officer", label: t("personnel.roleInventoryOfficer") },
            { value: "officer", label: t("personnel.roleOfficer") },
          ],
        },
        {
          key: "status",
          kind: "select",
          label: t("reports.filterStatus"),
          options: [
            { value: "active", label: t("status.active") },
            { value: "disabled", label: t("status.disabled") },
            { value: "pending", label: t("status.pending") },
          ],
        },
        { key: "department", kind: "text", label: t("reports.filterDepartment"), placeholder: t("reports.filterDepartmentPlaceholder") },
      ];
    case "leave":
      return [
        {
          key: "leaveType",
          kind: "select",
          label: t("reports.filterLeaveType"),
          options: [
            { value: "annual", label: t("reports.leaveTypeAnnual") },
            { value: "sick", label: t("reports.leaveTypeSick") },
            { value: "casual", label: t("reports.leaveTypeCasual") },
          ],
        },
        {
          key: "status",
          kind: "select",
          label: t("reports.filterStatus"),
          options: [
            { value: "pending", label: t("status.pending") },
            { value: "approved", label: t("status.approved") },
            { value: "rejected", label: t("status.rejected") },
          ],
        },
        { key: "officerId", kind: "officer", label: t("reports.filterOfficer") },
      ];
    case "crime":
      return [
        { key: "category", kind: "select", label: t("reports.filterCategory"), options: complaintCategoryOptions(t) },
        {
          key: "status",
          kind: "select",
          label: t("reports.filterStatus"),
          options: [
            { value: "open", label: t("status.open") },
            { value: "investigating", label: t("status.investigating") },
            { value: "paused", label: t("status.paused") },
            { value: "closed", label: t("status.closed") },
          ],
        },
        {
          key: "priority",
          kind: "select",
          label: t("reports.filterPriority"),
          options: [
            { value: "Low", label: t("complaints.priorityLow") },
            { value: "Medium", label: t("complaints.priorityMedium") },
            { value: "High", label: t("complaints.priorityHigh") },
            { value: "Urgent", label: t("complaints.priorityUrgent") },
          ],
        },
        { key: "assignedOfficerId", kind: "officer", label: t("reports.filterAssignedOfficer") },
      ];
    case "weapons":
      return [
        {
          key: "transactionType",
          kind: "select",
          label: t("reports.filterTransactionType"),
          options: [
            { value: "issue", label: t("status.issue") },
            { value: "return", label: t("status.return") },
            { value: "damaged", label: t("status.damaged") },
          ],
        },
        { key: "officerId", kind: "officer", label: t("reports.filterOfficer") },
      ];
    case "ammunition":
      return [{ key: "officerId", kind: "officer", label: t("reports.filterOfficer") }];
    default:
      return [];
  }
}

export function ReportsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { type: urlType } = useParams();
  const navigate = useNavigate();
  const isOverviewRole = OVERVIEW_ROLES.includes(user.role);

  // Only admin/oic ever fetch the Overview (stat cards + charts) — every
  // other role skips that request entirely (see the effect below), so
  // there's nothing for them to wait on and `loading` starts false.
  const [loading, setLoading] = useState(isOverviewRole);
  const [summary, setSummary] = useState(null);
  const [crimeData, setCrimeData] = useState([]);
  const [forceData, setForceData] = useState([]);

  // The paginated ledger — either "all categories" (hub) or scoped to
  // one category (workbench), depending on `view`.
  const [activityLog, setActivityLog] = useState([]);
  const [activityMeta, setActivityMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [activityLoading, setActivityLoading] = useState(false);

  // The active view comes from the URL (/reports vs /reports/:type) so the
  // workbench is bookmarkable and survives a refresh — not local state.
  const view = urlType || "hub";
  const [preset, setPreset] = useState("custom");
  const [range, setRange] = useState(defaultRange());
  const [filters, setFilters] = useState({});
  // Mirrors `filters`' officer-id entries as the { value, label } shape
  // SearchableSelect needs to render the current selection — filters
  // itself only ever holds the plain id string sent to the API.
  const [officerSelections, setOfficerSelections] = useState({});
  const [formError, setFormError] = useState("");

  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(null); // "pdf" | "csv" | null
  const [rowActionId, setRowActionId] = useState(null);

  const CATEGORY_DEFS = useMemo(
    () => [
      { type: "duty", title: t("reports.catDutyTitle"), desc: t("reports.catDutyDesc"), roles: ["admin", "oic", "duty_officer"] },
      { type: "officers", title: t("reports.catOfficersTitle"), desc: t("reports.catOfficersDesc"), roles: ["admin", "oic"] },
      { type: "leave", title: t("reports.catLeaveTitle"), desc: t("reports.catLeaveDesc"), roles: ["admin", "oic"] },
      { type: "crime", title: t("reports.catCrimeTitle"), desc: t("reports.catCrimeDesc"), roles: ["admin", "oic"] },
      { type: "weapons", title: t("reports.catWeaponsTitle"), desc: t("reports.catWeaponsDesc"), roles: ["admin", "oic", "inventory_officer"] },
      { type: "ammunition", title: t("reports.catAmmunitionTitle"), desc: t("reports.catAmmunitionDesc"), roles: ["admin", "oic", "inventory_officer"] },
      { type: "station", title: t("reports.catStationTitle"), desc: t("reports.catStationDesc"), roles: ["admin", "oic"] },
    ],
    [t]
  );

  const visibleCategories = useMemo(
    () => CATEGORY_DEFS.filter((c) => c.roles.includes(user.role)),
    [CATEGORY_DEFS, user.role]
  );
  const activeCategory = CATEGORY_DEFS.find((c) => c.type === view);
  const categoryAllowed = Boolean(activeCategory && activeCategory.roles.includes(user.role));
  const filterFields = useMemo(
    () => getFilterFields(activeCategory?.type, t),
    [activeCategory, t]
  );

  // Loads one page of the ledger, scoped to `type` when given. Used for
  // the initial load, page-change clicks, and refreshing after
  // generate/archive/delete.
  async function loadActivityLog(page = 1, type) {
    setActivityLoading(true);
    try {
      const res = await getActivityLog({ page, limit: PAGE_SIZE, type });
      setActivityLog(res.data);
      setActivityMeta({ page: res.page, totalPages: res.totalPages, total: res.total });
    } finally {
      setActivityLoading(false);
    }
  }

  // Re-reads the current page after an archive/delete; if that removed
  // the last row on a page beyond page 1, steps back a page instead of
  // leaving the ledger staring at an empty page.
  async function refreshLedger() {
    const scopedType = view === "hub" ? undefined : activeCategory.type;
    const res = await getActivityLog({ page: activityMeta.page, limit: PAGE_SIZE, type: scopedType });
    if (res.data.length === 0 && activityMeta.page > 1) {
      await loadActivityLog(activityMeta.page - 1, scopedType);
    } else {
      setActivityLog(res.data);
      setActivityMeta({ page: res.page, totalPages: res.totalPages, total: res.total });
    }
  }

  // Station-wide Overview (stat cards + charts) — admin/oic only. Every
  // other role starts with `loading` already false (see its useState
  // above) and never lingers on the hub long enough to need this (see the
  // redirect effect below), so there's nothing for this effect to do for them.
  useEffect(() => {
    if (!isOverviewRole) return;
    let cancelled = false;
    Promise.all([getReportsSummary(), getCrimeDistribution(), getForceStrength()])
      .then(([summaryRes, crimeRes, forceRes]) => {
        if (cancelled) return;
        setSummary(summaryRes);
        setCrimeData(crimeRes);
        setForceData(forceRes);
      })
      .catch((err) => console.error("Failed to load reports:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Covers the browser back/forward buttons too, not just clicks — any
  // time the URL's :type changes, the form resets and the ledger reloads
  // at page 1, scoped to the new category. Also bounces to a category
  // this role can actually see if the URL names an unknown or
  // not-permitted one (e.g. a duty_officer typing /reports/crime), and
  // sends a non-overview role straight to its own workbench instead of
  // leaving it on an empty hub. Runs above the loading early-returns
  // below so hook order stays stable across renders (Rules of Hooks).
  useEffect(() => {
    if (urlType) {
      const cat = CATEGORY_DEFS.find((c) => c.type === urlType);
      if (!cat || !cat.roles.includes(user.role)) {
        if (isOverviewRole) {
          navigate("/reports", { replace: true });
        } else {
          navigate(visibleCategories[0] ? `/reports/${visibleCategories[0].type}` : "/dashboard", { replace: true });
        }
        return;
      }
    } else if (!isOverviewRole) {
      navigate(visibleCategories[0] ? `/reports/${visibleCategories[0].type}` : "/dashboard", { replace: true });
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormError("");
    setPreset("custom");
    setRange(defaultRange());
    setFilters({});
    setOfficerSelections({});
    setPreviewData(null);
    loadActivityLog(1, urlType || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlType]);

  if (loading) return <Loader label={t("reports.loading")} />;
  if (view === "hub" && !isOverviewRole) return <Loader label={t("reports.loading")} />;
  if (view !== "hub" && !categoryAllowed) return <Loader label={t("reports.loading")} />;

  function applyPreset(p) {
    setPreset(p.key);
    if (p.range) setRange((r) => ({ ...r, ...p.range() }));
  }

  function resetFilters() {
    setPreset("custom");
    setRange(defaultRange());
    setFilters({});
    setOfficerSelections({});
    setFormError("");
    setPreviewData(null);
  }

  async function handlePreview() {
    if (!range.dateFrom || !range.dateTo) {
      setFormError(t("reports.dateRangeRequired"));
      return;
    }
    setFormError("");
    setPreviewing(true);
    setPreviewData(null);
    try {
      const res = await previewReport({
        type: activeCategory.type,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        filters: buildFilterPayload(filters),
      });
      setPreviewData(res);
    } catch (err) {
      setFormError(err.message || t("reports.previewFailed"));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExport(format) {
    setExporting(format);
    try {
      const record = await generateReport({
        type: activeCategory.type,
        title: activeCategory.title,
        format,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        filters: buildFilterPayload(filters),
      });
      await downloadReport(record.id, record.reportTitle || record.title);
      // The new report is newest-first, so it lands on page 1.
      await loadActivityLog(1, activeCategory.type);
    } catch (err) {
      window.alert(err.message || t("reports.generateFailed"));
    } finally {
      setExporting(null);
    }
  }

  async function handleDownload(row) {
    setRowActionId(row.id);
    try {
      await downloadReport(row.id, row.reportTitle || row.title);
    } catch (err) {
      window.alert(err.message || t("reports.downloadFailed"));
    } finally {
      setRowActionId(null);
    }
  }

  async function handleArchive(row) {
    setRowActionId(row.id);
    try {
      await archiveReport(row.id);
      await refreshLedger();
    } catch (err) {
      window.alert(err.message || t("reports.archiveFailed"));
    } finally {
      setRowActionId(null);
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(t("reports.confirmDelete"))) return;
    setRowActionId(row.id);
    try {
      await deleteReport(row.id);
      await refreshLedger();
    } catch (err) {
      window.alert(err.message || t("reports.deleteFailed"));
    } finally {
      setRowActionId(null);
    }
  }

  function actionColumns(extra = []) {
    return [
      { key: "logId", label: t("reports.logId"), render: (row) => <span className="mono-code">#{row.id.slice(-6).toUpperCase()}</span> },
      { key: "reportTitle", label: t("reports.colReportTitle"), render: (row) => row.reportTitle || row.title },
      ...extra,
      { key: "generatedBy", label: t("reports.colGeneratedBy"), render: (row) => row.generatedBy || row.generatedByName },
      { key: "date", label: t("reports.colDate"), render: (row) => (row.date || row.createdAt || "").slice(0, 10) },
      { key: "status", label: t("common.status"), render: (row) => <Badge status={row.status} /> },
      {
        key: "actions",
        label: t("common.actions"),
        render: (row) => (
          <div className="reports-row-actions">
            <Button variant="outline" onClick={() => handleDownload(row)} disabled={rowActionId === row.id}>
              {t("reports.download")}
            </Button>
            {row.status !== "Archived" && (
              <Button variant="ghost" onClick={() => handleArchive(row)} disabled={rowActionId === row.id}>
                {t("reports.archive")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => handleDelete(row)} disabled={rowActionId === row.id}>
              {t("reports.deleteAction")}
            </Button>
          </div>
        ),
      },
    ];
  }

  function renderFilterField(field) {
    if (field.kind === "officer") {
      return (
        <SearchableSelect
          key={field.key}
          label={field.label}
          value={officerSelections[field.key] || null}
          onChange={(opt) => {
            setOfficerSelections((s) => ({ ...s, [field.key]: opt }));
            setFilters((f) => ({ ...f, [field.key]: opt?.value || "" }));
          }}
          searchFn={searchOfficers}
          placeholder={field.label}
        />
      );
    }
    if (field.kind === "select") {
      // "all" (not "") is the sentinel for "no filter" — InputField's
      // <select> always renders its own disabled value="" placeholder
      // option, so reusing "" here would collide with that instead of
      // being a selectable option (see Complaints.jsx's own filter
      // dropdowns for the same convention).
      return (
        <InputField
          key={field.key}
          label={field.label}
          type="select"
          value={filters[field.key] || "all"}
          onChange={(e) => setFilters((f) => ({ ...f, [field.key]: e.target.value }))}
          options={[{ value: "all", label: t("reports.allOption") }, ...field.options]}
        />
      );
    }
    return (
      <InputField
        key={field.key}
        label={field.label}
        type="text"
        value={filters[field.key] || ""}
        placeholder={field.placeholder}
        onChange={(e) => setFilters((f) => ({ ...f, [field.key]: e.target.value }))}
      />
    );
  }

  const sidebar = (
    <aside className="reports-sidenav">
      <div className="reports-sidenav-heading">{t("reports.sidebarHeading")}</div>
      {isOverviewRole && (
        <button
          type="button"
          className={`reports-sidenav-item${view === "hub" ? " active" : ""}`}
          onClick={() => navigate("/reports")}
        >
          {t("reports.overview")}
        </button>
      )}
      {visibleCategories.map((cat) => (
        <button
          key={cat.type}
          type="button"
          className={`reports-sidenav-item${view === cat.type ? " active" : ""}`}
          onClick={() => navigate(`/reports/${cat.type}`)}
        >
          {cat.title}
        </button>
      ))}
    </aside>
  );

  if (view !== "hub" && activeCategory) {
    return (
      <div className="reports-page">
        <div className="reports-shell">
          {sidebar}
          <div className="reports-content">
            <div className="reports-header">
              <div>
                <h1>{activeCategory.title}</h1>
                <p className="reports-subtitle">{activeCategory.desc}</p>
              </div>
            </div>

            <Card variant="panel" className="reports-filter-card">
              <h4>{t("reports.reportPeriod")}</h4>
              <div className="reports-preset-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`reports-preset-btn${preset === p.key ? " active" : ""}`}
                    onClick={() => applyPreset(p)}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>

              <div className="reports-filter-grid">
                <InputField
                  label={t("reports.dateFrom")}
                  type="date"
                  value={range.dateFrom}
                  onChange={(e) => {
                    setPreset("custom");
                    setRange((r) => ({ ...r, dateFrom: e.target.value }));
                  }}
                />
                <InputField
                  label={t("reports.dateTo")}
                  type="date"
                  value={range.dateTo}
                  onChange={(e) => {
                    setPreset("custom");
                    setRange((r) => ({ ...r, dateTo: e.target.value }));
                  }}
                />
              </div>

              {filterFields.length > 0 && (
                <>
                  <h4 style={{ marginTop: 16 }}>{t("reports.filtersHeading")}</h4>
                  <div className="reports-filter-grid">{filterFields.map((field) => renderFilterField(field))}</div>
                </>
              )}

              {formError && <p className="field-error-text">{formError}</p>}

              <div className="reports-filter-actions">
                <Button variant="outline" onClick={resetFilters}>{t("reports.resetFilters")}</Button>
                <Button variant="primary" onClick={handlePreview} disabled={previewing}>
                  {previewing ? t("reports.previewing") : t("reports.previewReport")}
                </Button>
              </div>
            </Card>

            {previewData && (
              <Card variant="panel" className="reports-preview-card">
                <div className="reports-preview-letterhead">
                  <div className="reports-preview-force">SRI LANKA POLICE</div>
                  <h4>{activeCategory.title.toUpperCase()} — {t("reports.previewTitle")}</h4>
                </div>

                <div className="reports-preview-meta">
                  <span>{t("reports.period")}: {range.dateFrom} — {range.dateTo}</span>
                  <span>{t("reports.generatedBy")}: {user.fullName}</span>
                  <span>{t("reports.generatedOn")}: {toDateInput(new Date())}</span>
                </div>

                {Object.keys(previewData.summary || {}).length > 0 && (
                  <div className="reports-preview-stats">
                    {Object.entries(previewData.summary).map(([label, value]) => (
                      <div key={label} className="reports-preview-stat">
                        <span className="reports-preview-stat-value">{value}</span>
                        <span className="reports-preview-stat-label">{label}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="reports-table-wrapper">
                  <Table columns={previewData.columns} data={previewData.rows} emptyMessage={t("reports.noMatchingRecords")} />
                </div>
                {previewData.truncated && (
                  <p className="reports-preview-truncated">
                    {t("reports.showingFirstRows")
                      .replace("{shown}", previewData.rows.length)
                      .replace("{total}", previewData.total)}
                  </p>
                )}

                <div className="reports-preview-actions">
                  <Button variant="outline" onClick={() => setPreviewData(null)}>{t("reports.backToFilters")}</Button>
                  <Button variant="outline" onClick={() => handleExport("csv")} disabled={exporting !== null}>
                    {exporting === "csv" ? t("reports.generating") : t("reports.downloadCsv")}
                  </Button>
                  <Button variant="primary" onClick={() => handleExport("pdf")} disabled={exporting !== null}>
                    {exporting === "pdf" ? t("reports.generating") : t("reports.downloadPdf")}
                  </Button>
                </div>
              </Card>
            )}

            <Card variant="panel">
              <h4 style={{ marginBottom: 4 }}>{t("reports.categoryLedger")}</h4>
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
                {t("reports.categoryLedgerSubtitle")}
              </p>
              <div className="reports-table-wrapper">
                <Table columns={actionColumns()} data={activityLog} emptyMessage={t("reports.noReportsGenerated")} />
              </div>
              <PaginationBar
                activityMeta={activityMeta}
                activityLoading={activityLoading}
                onPageChange={(page) => loadActivityLog(page, activeCategory.type)}
                t={t}
              />
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reports-page">
      <div className="reports-shell">
        {sidebar}
        <div className="reports-content">
          <div className="reports-header">
            <div>
              <h1>{t("reports.title")}</h1>
              <p className="reports-subtitle">{t("reports.subtitle")}</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="outline" onClick={() => window.print()}>{t("reports.printView")}</Button>
            </div>
          </div>

          <div className="stat-grid">
            <StatCard label={t("reports.dutySummary")} value={`${summary?.dutyCompliancePercent ?? 0}%`} caption={summary?.dutyComplianceCaption} />
            <StatCard label={t("reports.leaveStatistics")} value={`${summary?.leaveStatisticsDays ?? 0} ${t("reports.days")}`} caption={summary?.leaveStatisticsCaption} />
            <StatCard label={t("reports.inventoryMovements")} value={`${summary?.inventoryMovements ?? 0} ${t("reports.items")}`} caption={summary?.inventoryMovementsCaption} />
          </div>

          <div className="reports-charts-grid">
            <Card variant="panel" className="chart-card">
              <h4>{t("reports.crimeIncidenceDistribution")}</h4>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={crimeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card variant="panel" className="chart-card">
              <h4>{t("reports.weeklyForceStrength")}</h4>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={forceData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Line type="monotone" dataKey="activeDuty" stroke="var(--color-success)" name={t("reports.activeDuty")} />
                  <Line type="monotone" dataKey="onLeave" stroke="var(--color-danger)" name={t("reports.onLeave")} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card variant="panel">
            <h4 style={{ marginBottom: 4 }}>{t("reports.recentActivityLogs")}</h4>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
              {t("reports.pdfCsvReadyText")}
            </p>
            <div className="reports-table-wrapper">
              <Table
                columns={actionColumns([{ key: "type", label: t("reports.colType"), render: (row) => categoryLabelFor(row.type, t) }])}
                data={activityLog}
                emptyMessage={t("reports.noReportsGenerated")}
              />
            </div>
            <PaginationBar
              activityMeta={activityMeta}
              activityLoading={activityLoading}
              onPageChange={(page) => loadActivityLog(page)}
              t={t}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
