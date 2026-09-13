import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, StatCard, Card, Table, Badge, Loader, MyDutyCard } from "../../components";
import { getDashboardSummary } from "../../services/dashboard";
import { getMyLeaveBalance } from "../../services/leave";
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
  const [assignedComplaints, setAssignedComplaints] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // allSettled, not all — one endpoint failing (e.g. no duty schedule
      // set up yet) shouldn't blank out the other three stat cards too.
      const [summaryRes, balanceRes, complaintsRes] = await Promise.allSettled([
        getDashboardSummary(),
        getMyLeaveBalance(),
        getMyAssignedComplaints(),
      ]);
      if (cancelled) return;

      if (summaryRes.status === "fulfilled") setSummary(summaryRes.value);
      else console.error("Failed to load dashboard summary:", summaryRes.reason);

      if (balanceRes.status === "fulfilled") setLeaveBalance(balanceRes.value);
      else console.error("Failed to load leave balance:", balanceRes.reason);

      if (complaintsRes.status === "fulfilled") setAssignedComplaints(complaintsRes.value);
      else console.error("Failed to load assigned complaints:", complaintsRes.reason);

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loader label={t("dashboard.loading")} />;

  // Medical has no cap (always null — see LeaveBalance.js), so only the
  // two finite types add up to a meaningful total here.
  const totalLeaveDays = leaveBalance
    ? leaveBalance.personal + leaveBalance.casual
    : 0;

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
          <Button variant="outline" onClick={() => navigate("/leave", { state: { openApply: true } })}>
            {t("dashboard.applyLeave")}
          </Button>
          {/* inventory_officer is the one role on this shared dashboard that can't
              register complaints (see Complaints.jsx's canManage) — hidden here
              rather than sending them to a form they'd just get a 403 submitting. */}
          {user?.role !== "inventory_officer" && (
            <Button variant="primary" onClick={() => navigate("/complaints", { state: { openRegister: true } })}>
              {t("dashboard.registerComplaint")}
            </Button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label={t("dashboard.todaysDuty")}
          // No specific branch shift today isn't "nothing" — same
          // General Duty / On Leave default as the Weekly Duty Schedule
          // card below, so the two don't visibly disagree about today.
          value={
            summary?.todaysDutyStatus === "assigned"
              ? summary.todaysDuty
              : summary?.todaysDutyStatus === "on_leave"
              ? t("status.on_leave")
              : summary?.todaysDutyStatus === "general_duty"
              ? t("status.general_duty")
              : "—"
          }
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
        <MyDutyCard />

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
