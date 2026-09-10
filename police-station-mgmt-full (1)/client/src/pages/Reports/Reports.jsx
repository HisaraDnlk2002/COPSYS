import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Button, Card, StatCard, Table, Loader, InputField, Badge } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import {
  getReportsSummary,
  getCrimeDistribution,
  getForceStrength,
  getActivityLog,
  generateReport,
  downloadReport,
  archiveReport,
  deleteReport,
} from "../../services/reports";
import "./Reports.css";

const PAGE_SIZE = 10;
const REAL_TYPES = ["duty", "leave", "inventory", "crime"];

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

function defaultRange() {
  const now = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { dateFrom: toDateInput(from), dateTo: toDateInput(now) };
}

export function ReportsPage() {
  const { t } = useLanguage();
  const { type: urlType } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [crimeData, setCrimeData] = useState([]);
  const [forceData, setForceData] = useState([]);

  // Per-category report counts shown on the hub cards. Fetched once
  // (cheap: limit=1 requests, we only need each category's `total`) —
  // independent from the paginated ledger below, which only ever holds
  // one page's worth of rows and can't be used to derive these counts.
  const [categoryCounts, setCategoryCounts] = useState({});

  // The paginated ledger — either "all categories" (hub) or scoped to
  // one type (workbench), depending on `view`.
  const [activityLog, setActivityLog] = useState([]);
  const [activityMeta, setActivityMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [activityLoading, setActivityLoading] = useState(false);

  // The active view comes from the URL (/reports vs /reports/:type) so the
  // workbench is bookmarkable and survives a refresh — not local state.
  const view = urlType || "hub";
  const [preset, setPreset] = useState("custom");
  const [filters, setFilters] = useState({ format: "pdf", ...defaultRange() });
  const [formError, setFormError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [rowActionId, setRowActionId] = useState(null);

  const REPORT_CATEGORIES = useMemo(
    () => [
      { code: "SEC-01", type: "duty", title: t("reports.catDutyTitle"), desc: t("reports.catDutyDesc") },
      { code: "SEC-02", type: "leave", title: t("reports.catLeaveTitle"), desc: t("reports.catLeaveDesc") },
      { code: "SEC-03", type: "inventory", title: t("reports.catInventoryTitle"), desc: t("reports.catInventoryDesc") },
      { code: "SEC-04", type: "crime", title: t("reports.catCrimeTitle"), desc: t("reports.catCrimeDesc") },
      {
        code: "SEC-05",
        type: "ammunition",
        title: t("reports.catAmmunitionTitle"),
        desc: t("reports.catAmmunitionDesc"),
        disabled: true,
      },
    ],
    [t]
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

  function loadCategoryCounts() {
    Promise.all(REAL_TYPES.map((type) => getActivityLog({ page: 1, limit: 1, type })))
      .then((results) => {
        const counts = {};
        REAL_TYPES.forEach((type, i) => {
          counts[type] = results[i].total;
        });
        setCategoryCounts(counts);
      })
      .catch((err) => console.error("Failed to load report counts:", err));
  }

  useEffect(() => {
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
    loadCategoryCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCategory = REPORT_CATEGORIES.find((c) => c.type === view);

  // Covers the browser back/forward buttons too, not just clicks — any
  // time the URL's :type changes, the form resets and the ledger reloads
  // at page 1, scoped to the new category (or unscoped for the hub).
  // Also bounces back to the hub if the URL names an unknown or disabled
  // category (e.g. someone bookmarks /reports/ammunition). Runs above
  // the loading early-return below so hook order stays stable across
  // renders (Rules of Hooks).
  useEffect(() => {
    if (urlType && (!activeCategory || activeCategory.disabled)) {
      navigate("/reports", { replace: true });
      return;
    }
    // Resets the workbench's form state whenever the URL's :type changes
    // (including to/from the hub) — covers browser back/forward too, not
    // just clicks, which a plain click handler wouldn't.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormError("");
    setPreset("custom");
    setFilters({ format: "pdf", ...defaultRange() });
    loadActivityLog(1, urlType || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlType]);

  if (loading) return <Loader label={t("reports.loading")} />;

  function openWorkbench(category) {
    if (category.disabled) return;
    navigate(`/reports/${category.type}`);
  }

  function applyPreset(p) {
    setPreset(p.key);
    if (p.range) {
      setFilters((f) => ({ ...f, ...p.range() }));
    }
  }

  function resetFilters() {
    setPreset("custom");
    setFilters({ format: "pdf", ...defaultRange() });
    setFormError("");
  }

  async function handleGenerate() {
    if (!filters.dateFrom || !filters.dateTo) {
      setFormError(t("reports.dateRangeRequired"));
      return;
    }
    setFormError("");
    setGenerating(true);
    try {
      await generateReport({ type: activeCategory.type, title: activeCategory.title, ...filters });
      // The new report is newest-first, so it lands on page 1.
      await loadActivityLog(1, activeCategory.type);
      loadCategoryCounts();
    } catch (err) {
      setFormError(err.message || t("reports.generateFailed"));
    } finally {
      setGenerating(false);
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

  // Reloads the current page after archive/delete; if that removes the
  // last row on a page beyond page 1, steps back a page so you don't end
  // up staring at an empty page.
  async function refreshAfterRowChange() {
    const scopedType = view === "hub" ? undefined : activeCategory.type;
    const res = await getActivityLog({ page: activityMeta.page, limit: PAGE_SIZE, type: scopedType });
    if (res.data.length === 0 && activityMeta.page > 1) {
      await loadActivityLog(activityMeta.page - 1, scopedType);
    } else {
      setActivityLog(res.data);
      setActivityMeta({ page: res.page, totalPages: res.totalPages, total: res.total });
    }
  }

  async function handleArchive(row) {
    setRowActionId(row.id);
    try {
      await archiveReport(row.id);
      await loadActivityLog();
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
      // Category badge counts on the hub are derived straight from
      // activityLog (see REPORT_CATEGORIES.map below), so reloading it
      // here updates both the table and the counts — no separate
      // counts fetch needed.
      await loadActivityLog();
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

  function PaginationBar({ scopedType }) {
    if (activityMeta.totalPages <= 1) return null;
    return (
      <div className="reports-pagination">
        <Button
          variant="outline"
          disabled={activityLoading || activityMeta.page <= 1}
          onClick={() => loadActivityLog(activityMeta.page - 1, scopedType)}
        >
          {t("reports.prevPage")}
        </Button>
        <span className="reports-pagination-label">
          {t("reports.pageOf").replace("{page}", activityMeta.page).replace("{total}", activityMeta.totalPages)}
        </span>
        <Button
          variant="outline"
          disabled={activityLoading || activityMeta.page >= activityMeta.totalPages}
          onClick={() => loadActivityLog(activityMeta.page + 1, scopedType)}
        >
          {t("reports.nextPage")}
        </Button>
      </div>
    );
  }

  if (view !== "hub" && activeCategory) {
    return (
      <div className="reports-page">
        <button type="button" className="reports-back-link" onClick={() => navigate("/reports")}>
          ← {t("reports.backToHub")}
        </button>

        <div className="reports-header">
          <div>
            <span className="reports-sec-code">{activeCategory.code}</span>
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
              value={filters.dateFrom}
              onChange={(e) => {
                setPreset("custom");
                setFilters((f) => ({ ...f, dateFrom: e.target.value }));
              }}
            />
            <InputField
              label={t("reports.dateTo")}
              type="date"
              value={filters.dateTo}
              onChange={(e) => {
                setPreset("custom");
                setFilters((f) => ({ ...f, dateTo: e.target.value }));
              }}
            />
            <InputField
              label={t("reports.format")}
              type="select"
              value={filters.format}
              options={[
                { value: "pdf", label: "PDF" },
                { value: "csv", label: "CSV" },
              ]}
              onChange={(e) => setFilters((f) => ({ ...f, format: e.target.value }))}
            />
          </div>

          {formError && <p className="field-error-text">{formError}</p>}

          <div className="reports-filter-actions">
            <Button variant="outline" onClick={resetFilters}>{t("reports.resetFilters")}</Button>
            <Button variant="primary" onClick={handleGenerate} disabled={generating}>
              {generating ? t("reports.generating") : t("reports.generateReport")}
            </Button>
          </div>
        </Card>

        <Card variant="panel">
          <h4 style={{ marginBottom: 4 }}>{t("reports.categoryLedger")}</h4>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
            {t("reports.categoryLedgerSubtitle")}
          </p>
          <div className="reports-table-wrapper">
            <Table columns={actionColumns()} data={activityLog} emptyMessage={t("reports.noReportsGenerated")} />
          </div>
          <PaginationBar scopedType={activeCategory.type} />
        </Card>
      </div>
    );
  }

  return (
    <div className="reports-page">
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

      <div className="reports-categories-heading">
        <h3>{t("reports.categoriesHeading")}</h3>
        <p>{t("reports.categoriesSubheading")}</p>
      </div>

      <div className="reports-category-grid">
        {REPORT_CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.type] ?? 0;
          return (
            <div
              key={cat.type}
              className={`reports-category-card${cat.disabled ? " disabled" : ""}`}
              onClick={() => openWorkbench(cat)}
              role="button"
              tabIndex={cat.disabled ? -1 : 0}
            >
              <div className="reports-category-top">
                <span className="reports-sec-code">{cat.code}</span>
                {cat.disabled ? (
                  <span className="reports-badge-soon">{t("reports.underDevelopment")}</span>
                ) : (
                  <span className="reports-badge-count">
                    {count} {count === 1 ? t("reports.reportSingular") : t("reports.reportPlural")}
                  </span>
                )}
              </div>
              <h4>{cat.title}</h4>
              <p>{cat.desc}</p>
              <div className="reports-category-action">
                {cat.disabled ? t("reports.underDevelopment") : `${t("reports.openWorkbench")} →`}
              </div>
            </div>
          );
        })}
      </div>

      <Card variant="panel">
        <h4 style={{ marginBottom: 4 }}>{t("reports.recentActivityLogs")}</h4>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          {t("reports.pdfCsvReadyText")}
        </p>
        <div className="reports-table-wrapper">
          <Table columns={actionColumns([{ key: "type", label: t("reports.colType") }])} data={activityLog} emptyMessage={t("reports.noReportsGenerated")} />
        </div>
        <PaginationBar scopedType={undefined} />
      </Card>
    </div>
  );
}
