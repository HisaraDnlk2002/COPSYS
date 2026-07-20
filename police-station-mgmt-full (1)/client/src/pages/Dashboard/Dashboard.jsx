import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, StatCard, Card, Table, Badge, Loader } from "../../components";
import { getDashboardSummary } from "../../services/dashboard";
import { getMyLeaveBalance } from "../../services/leave";
import { getMySchedule } from "../../services/dutySchedule";
import { getMyAssignedComplaints } from "../../services/complaints";
import { formatDateAndTime } from "../../utils/formatDate";
import "./Dashboard.css";

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const DASHBOARD_TITLE_BY_ROLE = {
    admin: t("dashboard.titleAdmin"),
    oic: t("dashboard.titleOic"),
    duty_officer: t("dashboard.titleDutyOfficer"),
    inventory_officer: t("dashboard.titleOfficer"),
    officer: t("dashboard.titleOfficer"),
  };

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [assignedComplaints, setAssignedComplaints] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [summaryRes, balanceRes, scheduleRes, complaintsRes] = await Promise.all([
          getDashboardSummary(),
          getMyLeaveBalance(),
          getMySchedule(),
          getMyAssignedComplaints(),
        ]);
        if (cancelled) return;
        setSummary(summaryRes);
        setLeaveBalance(balanceRes);
        setSchedule(scheduleRes);
        setAssignedComplaints(complaintsRes);
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loader label={t("dashboard.loading")} />;

  const totalLeaveDays = leaveBalance
    ? leaveBalance.annual + leaveBalance.sick + leaveBalance.casual
    : 0;

  const scheduleColumns = [
    { key: "day", label: t("dashboard.colDay") },
    {
      key: "shift",
      label: t("dashboard.colShiftTiming"),
      render: (row) => `${row.shiftStart} - ${row.shiftEnd}`,
    },
    { key: "department", label: t("dashboard.colAssignDepartment") },
    {
      key: "status",
      label: t("common.status"),
      render: (row) => <Badge status={row.status} />,
    },
  ];

  const complaintColumns = [
    { key: "refId", label: t("dashboard.colCaseId") },
    { key: "category", label: t("dashboard.colIncidentType") },
    { key: "dateOfIncident", label: t("dashboard.colReportedDate"), render: (row) => formatDateAndTime(row.dateOfIncident, row.incidentTime) },
    {
      key: "status",
      label: t("common.status"),
      render: (row) => <Badge status={row.status} />,
    },
  ];

  return (
    <div>
      <div className="dashboard-header">
        <h1>{DASHBOARD_TITLE_BY_ROLE[user?.role] || t("dashboard.titleDefault")}</h1>
        <div className="dashboard-header-actions">
          <Button variant="outline" onClick={() => navigate("/leave")}>
            {t("dashboard.applyLeave")}
          </Button>
          <Button variant="primary" onClick={() => navigate("/complaints")}>
            {t("dashboard.registerComplaint")}
          </Button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label={t("dashboard.todaysDuty")}
          value={summary?.todaysDuty || "—"}
          caption={summary?.todaysDutyShift ? `${t("dashboard.shift")} ${summary.todaysDutyShift}` : ""}
        />
        <StatCard label={t("dashboard.leaveStatus")} value={`${totalLeaveDays} ${t("dashboard.days")}`} caption={t("dashboard.availableBalance")} />
        <StatCard
          label={t("dashboard.assignedComplaints")}
          value={`${String(summary?.activeComplaints ?? 0).padStart(2, "0")} ${t("dashboard.cases")}`}
          caption={t("dashboard.activeInvestigations")}
        />
        <StatCard
          label={t("dashboard.nextShift")}
          value={summary?.nextShift || "—"}
          caption={summary?.nextShiftTime ? `${t("dashboard.shift")} ${summary.nextShiftTime}` : ""}
        />
      </div>

      <div className="dashboard-panels">
        <Card variant="panel">
          <div className="panel-header">
            <h3>{t("dashboard.weeklyDutySchedule")}</h3>
          </div>
          <Table columns={scheduleColumns} data={schedule} emptyMessage={t("dashboard.noShiftsScheduled")} />
        </Card>

        <Card variant="panel">
          <div className="panel-header">
            <h3>{t("dashboard.myAssignedComplaints")}</h3>
            <a className="panel-view-all" href="#" onClick={(e) => { e.preventDefault(); navigate("/complaints"); }}>
              {t("dashboard.viewAll")}
            </a>
          </div>
          <Table columns={complaintColumns} data={assignedComplaints} emptyMessage={t("dashboard.noComplaintsAssigned")} />
        </Card>
      </div>
    </div>
  );
}
