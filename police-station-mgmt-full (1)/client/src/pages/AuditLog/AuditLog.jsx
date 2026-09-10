import { useEffect, useMemo, useState } from "react";
import { Button, Card, Table, Badge, Loader } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import { getAuditLogs } from "../../services/auditLog";
import "./AuditLog.css";

const PAGE_SIZE = 15;

function formatTimestamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const date = d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

export function AuditLogPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  // The server already caps this list at 300 rows (see auditLogController),
  // but rendering all of them into one long table still meant endless
  // scrolling — page through the filtered results instead, same pattern
  // as Reports' ledger pagination.
  const [page, setPage] = useState(1);

  function loadLogs() {
    setLoading(true);
    setPage(1);
    return getAuditLogs()
      .then((res) => setLogs(res))
      .catch((err) => console.error("Failed to load audit logs:", err))
      .finally(() => setLoading(false));
  }

  function updateSearch(value) {
    setSearch(value);
    setPage(1);
  }

  function updateStatusFilter(value) {
    setStatusFilter(value);
    setPage(1);
  }

  function updateModuleFilter(value) {
    setModuleFilter(value);
    setPage(1);
  }

  useEffect(() => {
    let cancelled = false;
    getAuditLogs()
      .then((res) => {
        if (!cancelled) setLogs(res);
      })
      .catch((err) => console.error("Failed to load audit logs:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const moduleOptions = useMemo(() => {
    return [...new Set(logs.map((l) => l.module))].sort();
  }, [logs]);

  const filteredLogs = logs.filter((l) => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (moduleFilter !== "all" && l.module !== moduleFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!l.userName?.toLowerCase().includes(q) && !l.action?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.max(Math.ceil(filteredLogs.length / PAGE_SIZE), 1);
  // Clamp rather than reset via effect — a shrinking result set (filter
  // change, refresh) just falls back to the last valid page instead of
  // needing an extra render/effect round-trip.
  const safePage = Math.min(page, totalPages);
  const pagedLogs = filteredLogs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const columns = [
    { key: "userName", label: t("auditLog.colUser") },
    { key: "action", label: t("auditLog.colActionExecuted") },
    { key: "module", label: t("auditLog.colSystemModule") },
    { key: "createdAt", label: t("auditLog.colRealTimestamp"), render: (row) => formatTimestamp(row.createdAt) },
    { key: "status", label: t("common.status"), render: (row) => <Badge status={row.status} /> },
  ];

  if (loading) return <Loader label={t("auditLog.loading")} />;

  return (
    <div>
      <div className="audit-log-header">
        <h1>{t("auditLog.title")}</h1>
      </div>

      <Card variant="panel">
        <div className="audit-log-toolbar">
          <input
            className="audit-log-search"
            placeholder={t("auditLog.searchPlaceholder")}
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
          />
          <select className="audit-log-select" value={statusFilter} onChange={(e) => updateStatusFilter(e.target.value)}>
            <option value="all">{t("auditLog.allStatuses")}</option>
            <option value="success">{t("auditLog.success")}</option>
            <option value="failed">{t("auditLog.failed")}</option>
          </select>
          <select className="audit-log-select" value={moduleFilter} onChange={(e) => updateModuleFilter(e.target.value)}>
            <option value="all">{t("auditLog.allModules")}</option>
            {moduleOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Button variant="outline" type="button" onClick={loadLogs}>{t("auditLog.refresh")}</Button>
        </div>

        <Table columns={columns} data={pagedLogs} emptyMessage={t("auditLog.noEntriesMatch")} />

        {totalPages > 1 && (
          <div className="audit-log-pagination">
            <Button variant="outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              {t("reports.prevPage")}
            </Button>
            <span className="audit-log-pagination-label">
              {t("reports.pageOf").replace("{page}", safePage).replace("{total}", totalPages)}
            </span>
            <Button variant="outline" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
              {t("reports.nextPage")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
