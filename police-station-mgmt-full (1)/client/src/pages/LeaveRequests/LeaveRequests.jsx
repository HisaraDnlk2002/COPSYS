import { useEffect, useState } from "react";
import { Button, InputField, Card, StatCard, Table, Badge, Loader } from "../../components";
import { SearchableSelect } from "../../components";
import { getMyLeaveRequests, getMyLeaveBalance, applyForLeave } from "../../services/leave";
import { searchOfficers } from "../../services/officers";
import "./LeaveRequests.css";

const LEAVE_CATEGORY_OPTIONS = [
  { value: "annual", label: "Annual Leave" },
  { value: "sick", label: "Sick Leave" },
  { value: "casual", label: "Casual Leave" },
];

function wordCount(text) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const ms = new Date(end) - new Date(start);
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

export function LeaveRequestsPage() {
  const [view, setView] = useState("history"); // "history" | "apply"
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [balance, setBalance] = useState(null);

  const [form, setForm] = useState({
    leaveType: "",
    startDate: "",
    endDate: "",
    justification: "",
    emergencyContact: "", // phone number kept for the submission payload
    emergencyContactOfficer: null, // full { value, label, phone } option for the search field
    actingOfficer: "",
  });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [requestsRes, balanceRes] = await Promise.all([getMyLeaveRequests(), getMyLeaveBalance()]);
      setRequests(requestsRes);
      setBalance(balanceRes);
    } catch (err) {
      console.error("Failed to load leave data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyLeaveRequests(), getMyLeaveBalance()])
      .then(([requestsRes, balanceRes]) => {
        if (cancelled) return;
        setRequests(requestsRes);
        setBalance(balanceRes);
      })
      .catch((err) => console.error("Failed to load leave data:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleEmergencyContactChange(option) {
    setForm((f) => ({
      ...f,
      emergencyContactOfficer: option,
      emergencyContact: option?.phone || "",
    }));
  }

  const days = daysBetween(form.startDate, form.endDate);
  const needsLongJustification = form.leaveType === "annual" && days > 5;

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");

    if (!form.leaveType || !form.startDate || !form.endDate) {
      setFormError("Please fill in leave category and both dates.");
      return;
    }
    if (days <= 0) {
      setFormError("Resuming date must be on or after the commencing date.");
      return;
    }
    if (needsLongJustification && wordCount(form.justification) < 30) {
      setFormError("Annual leave over 5 days requires at least 30 words in the justification.");
      return;
    }

    setSubmitting(true);
    try {
      await applyForLeave({
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        days,
        justification: form.justification,
        emergencyContact: form.emergencyContact,
        remarks: form.justification.slice(0, 60),
      });
      setForm({
        leaveType: "",
        startDate: "",
        endDate: "",
        justification: "",
        emergencyContact: "",
        emergencyContactOfficer: null,
        actingOfficer: "",
      });
      setView("history");
      await loadData();
    } catch (err) {
      setFormError(err.message || "Could not submit leave application");
    } finally {
      setSubmitting(false);
    }
  }

  const historyColumns = [
    { key: "refId", label: "REF ID" },
    { key: "leaveType", label: "Leave Type", render: (r) => <span style={{ textTransform: "capitalize" }}>{r.leaveType}</span> },
    { key: "duration", label: "Duration", render: (r) => `${r.startDate} - ${r.endDate}` },
    { key: "days", label: "Days" },
    { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
    { key: "remarks", label: "Remarks" },
  ];

  if (loading) return <Loader label="Loading leave requests…" />;

  if (view === "apply") {
    return (
      <div>
        <div className="leave-page-header">
          <h1>Official document submission</h1>
        </div>

        <form className="leave-form-layout" onSubmit={handleSubmit}>
          <Card variant="panel">
            <h3 style={{ marginBottom: 4 }}>Officer Information</h3>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
              Details as per the central database
            </p>

            <InputField label="Leave Category" type="select" required value={form.leaveType}
              onChange={(e) => updateField("leaveType", e.target.value)} options={LEAVE_CATEGORY_OPTIONS} />

            <div className="leave-form-grid">
              <InputField label="Commencing Date" type="date" required value={form.startDate}
                onChange={(e) => updateField("startDate", e.target.value)} min={todayISO()} />
              <InputField label="Resuming Date" type="date" required value={form.endDate}
                onChange={(e) => updateField("endDate", e.target.value)} min={form.startDate || todayISO()} />
            </div>

            <div className="field-full">
              <InputField
                label="Detailed Justification/Reason"
                type="textarea"
                value={form.justification}
                onChange={(e) => updateField("justification", e.target.value)}
                placeholder="Explain the reason for this leave request"
                helperText={needsLongJustification ? `${wordCount(form.justification)} / 30 words minimum` : undefined}
              />
            </div>

            <SearchableSelect
              label="Emergency Contact"
              required
              value={form.emergencyContactOfficer}
              onChange={handleEmergencyContactChange}
              searchFn={searchOfficers}
              placeholder="Search officer by name…"
              helperText="Search the central officer directory and select a contact"
            />

            <div className="consent-box">
              <input type="checkbox" required defaultChecked style={{ marginTop: 3 }} />
              <span>
                I understand that any false statement or failure to report for duty on the scheduled date may
                lead to disciplinary action as per the Police Ordinance and Establishment Code.
              </span>
            </div>

            {formError && <p style={{ color: "var(--color-danger)", marginBottom: 16 }}>{formError}</p>}

            <div className="form-actions">
              <Button variant="ghost" type="button" onClick={() => setView("history")}>
                Discard Draft
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Leave Application"}
              </Button>
            </div>
          </Card>

          <aside className="submission-rules-panel">
            <h3>Submission Rules</h3>
            <p><strong>Advance Notice:</strong> Casual leave applications must be submitted at least 48 hours in advance.</p>
            <p><strong>Annual Leave:</strong> Annual leave requests exceeding 5 days require a minimum of 30 words in the justification section.</p>
            <p><strong>Medical Evidence:</strong> Medical leave exceeding 2 days must have a digital copy of the Government Medical Certificate attached.</p>
            <p><strong>Duty Handover:</strong> Applicants must identify an Acting Officer who has confirmed availability for the requested period.</p>
            <p><strong>Blackout Dates:</strong> Leave may be restricted during high-security alerts or national holidays as per Department circulars.</p>
          </aside>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="leave-page-header">
        <h1>LEAVE REQUESTS</h1>
        <Button variant="outline" onClick={() => setView("apply")}>
          Apply Leave
        </Button>
      </div>

      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Annual leaves" value={`${balance?.annual ?? 0} Days`} />
        <StatCard label="Sick Leaves" value={`${balance?.sick ?? 0} Days`} />
        <StatCard label="Casual Leaves" value={`${balance?.casual ?? 0} Days`} />
        <StatCard label="Pending Leaves" value={requests.filter((r) => r.status === "pending").length} />
      </div>

      <Card variant="panel">
        <Table columns={historyColumns} data={requests} emptyMessage="No leave requests yet" />
      </Card>
    </div>
  );
}
