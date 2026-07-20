import { useEffect, useState } from "react";
import { StatCard, Card, Table, Badge, Loader, Modal, Button, InputField, AssignmentCell } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import { getOicStats } from "../../services/oicDashboard";
import { getAllLeaveRequests, approveLeaveRequest, rejectLeaveRequest } from "../../services/leave";
import { getComplaints, assignComplaint } from "../../services/complaints";
import { listUsers } from "../../services/users";
import { formatDate } from "../../utils/formatDate";
import "./OicDashboard.css";

const ASSIGNABLE_ROLES = ["duty_officer", "officer"];

export function OicDashboardPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [officers, setOfficers] = useState([]);

  const [rejectingId, setRejectingId] = useState(null); // id of the request shown in the reject-remark modal
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getOicStats(), getAllLeaveRequests(), getComplaints(), listUsers()]).then((results) => {
      if (cancelled) return;
      const [statsRes, leaveRes, complaintsRes, usersRes] = results;

      if (statsRes.status === "fulfilled") {
        setStats(statsRes.value);
      } else {
        console.error("Failed to load OIC stats:", statsRes.reason);
      }

      if (leaveRes.status === "fulfilled") {
        setLeaveRequests(leaveRes.value.filter((l) => l.status === "pending"));
      } else {
        console.error("Failed to load leave requests:", leaveRes.reason);
      }

      if (complaintsRes.status === "fulfilled") {
        setComplaints(complaintsRes.value);
      } else {
        console.error("Failed to load complaints:", complaintsRes.reason);
      }

      if (usersRes.status === "fulfilled") {
        setOfficers(usersRes.value.filter((u) => ASSIGNABLE_ROLES.includes(u.role)));
      } else {
        console.error("Failed to load officers:", usersRes.reason);
      }

      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleApprove(id) {
    try {
      await approveLeaveRequest(id);
      setLeaveRequests((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      console.error("Failed to approve leave request:", err);
      alert(err.message || "Could not approve this leave request");
    }
  }

  function openRejectModal(id) {
    setRejectingId(id);
    setRejectRemarks("");
  }

  async function handleReject() {
    if (!rejectRemarks.trim()) return;
    setRejectSubmitting(true);
    try {
      await rejectLeaveRequest(rejectingId, rejectRemarks.trim());
      setLeaveRequests((prev) => prev.filter((l) => l.id !== rejectingId));
      setRejectingId(null);
      setRejectRemarks("");
    } catch (err) {
      console.error("Failed to reject leave request:", err);
      alert(err.message || "Could not reject this leave request");
    } finally {
      setRejectSubmitting(false);
    }
  }

  async function handleAssign(complaintId, officerId) {
    const updated = await assignComplaint(complaintId, officerId);
    setComplaints((prev) => prev.map((c) => (c.id === complaintId ? { ...c, ...updated } : c)));
  }

  if (loading) return <Loader label={t("oic.loading")} />;

  const leaveColumns = [
    { key: "officerName", label: t("oic.colOfficerRank") },
    { key: "duration", label: t("oic.colDates"), render: (r) => `${formatDate(r.startDate)} - ${formatDate(r.endDate)}` },
    { key: "leaveType", label: t("oic.colType"), render: (r) => <span style={{ textTransform: "capitalize" }}>{r.leaveType}</span> },
    {
      key: "actions",
      label: t("common.actions"),
      render: (r) => (
        <div className="inline-actions">
          <button className="leave-action-btn approve" onClick={() => handleApprove(r.id)}>{t("oic.approve")}</button>
          <button className="leave-action-btn deny" onClick={() => openRejectModal(r.id)}>{t("oic.deny")}</button>
        </div>
      ),
    },
  ];

  const complaintColumns = [
    { key: "refId", label: t("oic.colComplaintId") },
    { key: "category", label: t("oic.colNature") },
    {
      key: "status",
      label: t("common.status"),
      render: (r) =>
        r.severity === "Grave Crime" ? <Badge tone="danger">{t("status.critical")}</Badge> : <Badge status={r.status} />,
    },
    {
      key: "assignment",
      label: t("oic.colAssignment"),
      render: (r) => <AssignmentCell complaint={r} officers={officers} onAssign={handleAssign} />,
    },
  ];

  return (
    <div>
      <div className="oic-header">
        <h1>{t("oic.title")}</h1>
        <p className="oic-subtitle">{t("oic.subtitle")}</p>
      </div>

      <div className="stat-grid">
        <StatCard label={t("oic.totalOfficers")} value={stats?.totalOfficers} caption={`${t("oic.currentStationStrength")} ${stats?.currentStationStrength || ""}`} />
        <StatCard label={t("oic.pendingLeaves")} value={stats?.pendingLeaves} caption={t("oic.requiredImmediateReviews")} />
        <StatCard label={t("oic.activeComplaints")} value={stats?.activeComplaints} caption={stats?.activeComplaintsCaption} />
        <StatCard label={t("oic.todaysDuties")} value={stats?.todaysDuties} caption={stats?.todaysDutiesCaption} />
      </div>

      <div className="oic-panels">
        <Card variant="panel">
          <div className="oic-panel-header">
            <h3>{t("oic.personnelLeaveRequests")}</h3>
            <span className="pending-count-badge">{leaveRequests.length} {t("oic.pending")}</span>
          </div>
          <Table columns={leaveColumns} data={leaveRequests} emptyMessage={t("oic.noPendingLeaveRequests")} />
        </Card>

        <Card variant="panel">
          <div className="oic-panel-header">
            <h3>{t("oic.incidentComplaintMonitor")}</h3>
            <span className="pending-count-badge">
              {complaints.filter((c) => !c.assignedOfficerId).length} {t("oic.unassignedCount")}
            </span>
          </div>
          <Table columns={complaintColumns} data={complaints} emptyMessage={t("oic.noActiveComplaints")} />
        </Card>
      </div>

      <Modal
        open={rejectingId !== null}
        onClose={() => setRejectingId(null)}
        title={t("oic.rejectModalTitle")}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setRejectingId(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={handleReject} disabled={rejectSubmitting || !rejectRemarks.trim()}>
              {rejectSubmitting ? t("oic.rejecting") : t("oic.rejectRequest")}
            </Button>
          </>
        }
      >
        <InputField
          label={t("oic.reasonForRejection")}
          type="textarea"
          required
          value={rejectRemarks}
          onChange={(e) => setRejectRemarks(e.target.value)}
          placeholder={t("oic.reasonForRejectionPlaceholder")}
        />
      </Modal>
    </div>
  );
}
