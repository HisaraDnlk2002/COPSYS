import { useEffect, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Button, Card, StatCard, Table, Loader } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import {
  getReportsSummary,
  getCrimeDistribution,
  getForceStrength,
  getActivityLog,
  getReportEngineSections,
} from "../../services/reports";
import "./Reports.css";

export function ReportsPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [crimeData, setCrimeData] = useState([]);
  const [forceData, setForceData] = useState([]);
  const [activityLog, setActivityLog] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getReportsSummary(), getCrimeDistribution(), getForceStrength(), getActivityLog()])
      .then(([summaryRes, crimeRes, forceRes, activityRes]) => {
        if (cancelled) return;
        setSummary(summaryRes);
        setCrimeData(crimeRes);
        setForceData(forceRes);
        setActivityLog(activityRes);
      })
      .catch((err) => console.error("Failed to load reports:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loader label={t("reports.loading")} />;

  const sections = getReportEngineSections();

  const logColumns = [
    { key: "reportTitle", label: t("reports.colReportTitle") },
    { key: "type", label: t("reports.colType") },
    { key: "generatedBy", label: t("reports.colGeneratedBy") },
    { key: "date", label: t("reports.colDate") },
    { key: "status", label: t("common.status") },
  ];

  return (
    <div className="reports-layout">
      <aside className="reports-sidebar">
        <h3 style={{ marginBottom: 16 }}>{t("reports.reportEngine")}</h3>
        {sections.map((section) => (
          <div key={section.group} className="reports-sidebar-group">
            <h4>{section.group}</h4>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <div>
        <div className="reports-header">
          <div>
            <h1>{t("reports.title")}</h1>
            <p className="reports-subtitle">{t("reports.subtitle")}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline">{t("reports.last30Days")}</Button>
            <Button variant="outline">{t("reports.printView")}</Button>
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
          <Table columns={logColumns} data={activityLog} emptyMessage={t("reports.noReportsGenerated")} />
        </Card>
      </div>
    </div>
  );
}