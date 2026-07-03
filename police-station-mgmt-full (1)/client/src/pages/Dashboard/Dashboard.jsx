import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, StatCard, Card, Table, Badge, Loader } from "../../components";
import { getDashboardSummary } from "../../services/dashboard";
import { getMyLeaveBalance } from "../../services/leave";
import { getMySchedule } from "../../services/dutySchedule";
import { getMyAssignedComplaints } from "../../services/complaints";
import "./Dashboard.css";

const DASHBOARD_TITLE_BY_ROLE = {
  admin: "ADMIN DASHBOARD",
  oic: "OIC DASHBOARD",
  duty_officer: "DUTY OFFICER DASHBOARD",
  inventory_officer: "OFFICER DASHBOARD",
  officer: "OFFICER DASHBOARD",
};

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

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

  if (loading) return <Loader label="Loading dashboard…" />;

  const totalLeaveDays = leaveBalance
    ? leaveBalance.annual + leaveBalance.sick + leaveBalance.casual
    : 0;

  const scheduleColumns = [
    { key: "day", label: "Day" },
    {
      key: "shift",
      label: "Shift Timing",
      render: (row) => `${row.shiftStart} - ${row.shiftEnd}`,
    },
    { key: "department", label: "Assign Department" },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge status={row.status} />,
    },
  ];

  const complaintColumns = [
    { key: "refId", label: "Case Id" },
    { key: "category", label: "Incident Type" },
    { key: "dateOfIncident", label: "Reported Date" },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge status={row.status} />,
    },
  ];

  return (
    <div>
      <div className="dashboard-header">
        <h1>{DASHBOARD_TITLE_BY_ROLE[user?.role] || "DASHBOARD"}</h1>
        <div className="dashboard-header-actions">
          <Button variant="outline" onClick={() => navigate("/leave")}>
            Apply Leave
          </Button>
          <Button variant="primary" onClick={() => navigate("/complaints")}>
            Register complaint
          </Button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Today's Duty"
          value={summary?.todaysDuty || "—"}
          caption={summary?.todaysDutyShift ? `shift ${summary.todaysDutyShift}` : ""}
        />
        <StatCard label="Leave Status" value={`${totalLeaveDays} Days`} caption="Available Balance" />
        <StatCard
          label="Assigned Complaints"
          value={`${String(summary?.activeComplaints ?? 0).padStart(2, "0")} Cases`}
          caption="Active Investigations"
        />
        <StatCard
          label="Next Shift"
          value={summary?.nextShift || "—"}
          caption={summary?.nextShiftTime ? `shift ${summary.nextShiftTime}` : ""}
        />
      </div>

      <div className="dashboard-panels">
        <Card variant="panel">
          <div className="panel-header">
            <h3>Weekly Duty Schedule</h3>
          </div>
          <Table columns={scheduleColumns} data={schedule} emptyMessage="No shifts scheduled this week" />
        </Card>

        <Card variant="panel">
          <div className="panel-header">
            <h3>My assigned complaints</h3>
            <a className="panel-view-all" href="#" onClick={(e) => { e.preventDefault(); navigate("/complaints"); }}>
              View All
            </a>
          </div>
          <Table columns={complaintColumns} data={assignedComplaints} emptyMessage="No complaints assigned to you" />
        </Card>
      </div>
    </div>
  );
}
