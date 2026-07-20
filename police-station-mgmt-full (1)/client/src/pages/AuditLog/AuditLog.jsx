import { useEffect, useMemo, useState } from "react";
import { Button, Card, Table, Badge, Loader } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import { getAuditLogs } from "../../services/auditLog";
import "./AuditLog.css";

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

  function loadLogs() {
    setLoading(true);
    return getAuditLogs()
      .then((res) => setLogs(res))
      .catch((err) => console.error("Failed to load audit logs:", err))
      .finally(() => setLoading(false));
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
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="audit-log-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">{t("auditLog.allStatuses")}</option>
            <option value="success">{t("auditLog.success")}</option>
            <option value="failed">{t("auditLog.failed")}</option>
          </select>
          <select className="audit-log-select" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="all">{t("auditLog.allModules")}</option>
            {moduleOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Button variant="outline" type="button" onClick={loadLogs}>{t("auditLog.refresh")}</Button>
        </div>

        <Table columns={columns} data={filteredLogs} emptyMessage={t("auditLog.noEntriesMatch")} />
      </Card>
    </div>
  );
}
