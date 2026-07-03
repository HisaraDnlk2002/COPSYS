import { useEffect, useState } from "react";
import { StatCard, Card, Table, Badge, Loader } from "../../components";
import { getOicStats } from "../../services/oicDashboard";
import { getAllLeaveRequests, approveLeaveRequest, rejectLeaveRequest } from "../../services/leave";
import { getComplaints, assignComplaint } from "../../services/complaints";
import { dummyUsers } from "../../services/dummyData";
import "./OicDashboard.css";

export function OicDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [complaints, setComplaints] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getOicStats(), getAllLeaveRequests(), getComplaints()])
      .then(([statsRes, leaveRes, complaintsRes]) => {
        if (cancelled) return;
        setStats(statsRes);
        setLeaveRequests(leaveRes.filter((l) => l.status === "pending"));
        setComplaints(complaintsRes);
      })
      .catch((err) => console.error("Failed to load OIC dashboard:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleApprove(id) {
    await approveLeaveRequest(id);
    setLeaveRequests((prev) => prev.filter((l) => l.id !== id));
  }

  async function handleReject(id) {
    await rejectLeaveRequest(id);
    setLeaveRequests((prev) => prev.filter((l) => l.id !== id));
  }

  async function handleAssign(complaintId, officerId) {
    if (!officerId) return;
    const updated = await assignComplaint(complaintId, officerId);
    setComplaints((prev) => prev.map((c) => (c.id === complaintId ? { ...c, ...updated } : c)));
  }

  if (loading) return <Loader label="Loading command dashboard…" />;

  const leaveColumns = [
    { key: "officerName", label: "Officer / Rank" },
    { key: "duration", label: "Dates", render: (r) => `${r.startDate} - ${r.endDate}` },
    { key: "leaveType", label: "Type", render: (r) => <span style={{ textTransform: "capitalize" }}>{r.leaveType}</span> },
    {
      key: "actions",
      label: "Actions",
      render: (r) => (
        <div className="inline-actions">
          <button className="icon-btn approve" title="Approve" onClick={() => handleApprove(r.id)}>✓</button>
          <button className="icon-btn reject" title="Reject" onClick={() => handleReject(r.id)}>✕</button>
        </div>
      ),
    },
  ];

  const complaintColumns = [
    { key: "refId", label: "Complaint ID" },
    { key: "category", label: "Nature" },
    {
      key: "status",
      label: "Status",
      render: (r) =>
        r.severity === "critical" ? <Badge tone="danger">Critical</Badge> : <Badge status={r.status} />,
    },
    {
      key: "assignment",
      label: "Assignment",
      render: (r) => {
        const assignedOfficer = dummyUsers.find((u) => u.id === r.assignedOfficerId);
        if (assignedOfficer) return assignedOfficer.fullName;
        return (
          <select
            className="assign-select"
            defaultValue=""
            onChange={(e) => handleAssign(r.id, e.target.value)}
          >
            <option value="" disabled>Assign…</option>
            {dummyUsers
              .filter((u) => ["duty_officer", "officer"].includes(u.role))
              .map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
          </select>
        );
      },
    },
  ];

  return (
    <div>
      <div className="oic-header">
        <h1>OIC Command Dashboard</h1>
        <p className="oic-subtitle">District Oversight & Control — Administrative Command Oversight</p>
      </div>

      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <StatCard label="Total Officers" value={stats?.totalOfficers} caption={`Current station strength ${stats?.currentStationStrength || ""}`} />
        <StatCard label="Pending Leaves" value={stats?.pendingLeaves} caption="Required immediate reviews" />
        <StatCard label="Active Complaints" value={stats?.activeComplaints} caption={stats?.activeComplaintsCaption} />
        <StatCard label="Today's Duties" value={stats?.todaysDuties} caption={stats?.todaysDutiesCaption} />
      </div>

      <div className="oic-panels">
        <Card variant="panel">
          <div className="oic-panel-header">
            <h3>Personnel Leave Requests</h3>
            <span className="pending-count-badge">{leaveRequests.length} Pending</span>
          </div>
          <Table columns={leaveColumns} data={leaveRequests} emptyMessage="No pending leave requests" />
        </Card>

        <Card variant="panel">
          <div className="oic-panel-header">
            <h3>Incident & Complaint Monitor</h3>
            <span className="pending-count-badge">
              {complaints.filter((c) => !c.assignedOfficerId).length} Unassigned
            </span>
          </div>
          <Table columns={complaintColumns} data={complaints} emptyMessage="No active complaints" />
        </Card>
      </div>
    </div>
  );
}
