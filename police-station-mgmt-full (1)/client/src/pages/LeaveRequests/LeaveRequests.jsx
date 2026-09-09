import { useEffect, useMemo, useState } from "react";
import { Button, InputField, Card, StatCard, Table, Badge, Loader, Modal } from "../../components";
import { SearchableSelect } from "../../components";
import {
  getMyLeaveRequests,
  getAllLeaveRequests,
  getMyLeaveBalance,
  getLeaveBalanceForOfficer,
  applyForLeave,
  approveLeaveRequest,
  rejectLeaveRequest,
} from "../../services/leave";
import { searchOfficers } from "../../services/officers";
import { listUsers } from "../../services/users";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { formatDate } from "../../utils/formatDate";
import "./LeaveRequests.css";

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

// ISO 8601 week number, e.g. "2026-W29" — used only as a sort key.
function isoWeekKey(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function leaveSortKey(row, granularity) {
  const iso = (row.startDate || "").toString().slice(0, 10);
  if (!iso) return "";
  const [y, m] = iso.split("-");
  switch (granularity) {
    case "year":
      return y;
    case "month":
      return `${y}-${m}`;
    case "week":
      return isoWeekKey(iso);
    default:
      return iso;
  }
}

export function LeaveRequestsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOic = user?.role === "oic";

  const LEAVE_CATEGORY_OPTIONS = [
    { value: "annual", label: t("leave.categoryAnnual") },
    { value: "sick", label: t("leave.categorySick") },
    { value: "casual", label: t("leave.categoryCasual") },
  ];

  const [view, setView] = useState("history"); // "history" | "apply"
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [balance, setBalance] = useState(null);
  const [filterBy, setFilterBy] = useState("none"); // "none" | "date" | "week" | "month" | "year"
  const [filterValue, setFilterValue] = useState("");

  const [rejectingId, setRejectingId] = useState(null); // id of the request shown in the reject-remark modal
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const [officers, setOfficers] = useState([]); // used to look up the department/acting officer shown in the "View" modal
  const [viewing, setViewing] = useState(null); // leave request shown in the View Details modal
  const [viewBalance, setViewBalance] = useState(null);
  const [viewBalanceLoading, setViewBalanceLoading] = useState(false);

  const [form, setForm] = useState({
    leaveType: "",
    startDate: "",
    endDate: "",
    justification: "",
    emergencyContact: "", // a personal contact's phone number — not a colleague
    actingOfficerOption: null, // full { value, label, subtitle } option for the search field
  });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [requestsRes, balanceRes] = await Promise.all([
        isOic ? getAllLeaveRequests() : getMyLeaveRequests(),
        getMyLeaveBalance(),
      ]);
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
    Promise.all([isOic ? getAllLeaveRequests() : getMyLeaveRequests(), getMyLeaveBalance()])
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
  }, [isOic]);

    useEffect(() => {
    // Only OIC actually sees this data (department + acting-officer name
    // in the View Details modal) — everyone else's Acting Officer search
    // goes through searchOfficers() instead, which has no role restriction.
    if (!isOic) return;
    let cancelled = false;
    listUsers()
      .then((res) => {
        if (!cancelled) setOfficers(res);
      })
      .catch((err) => console.error("Failed to load officers:", err));
    return () => {
      cancelled = true;
    };
  }, [isOic]);

  function openViewModal(row) {
    setViewing(row);
    setViewBalance(null);
    setViewBalanceLoading(true);
    getLeaveBalanceForOfficer(row.officerId)
      .then((res) => setViewBalance(res))
      .catch((err) => console.error("Failed to load officer's leave balance:", err))
      .finally(() => setViewBalanceLoading(false));
  }

  async function handleApprove(id) {
    try {
      const updated = await approveLeaveRequest(id);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
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
      const updated = await rejectLeaveRequest(rejectingId, rejectRemarks.trim());
      setRequests((prev) => prev.map((r) => (r.id === rejectingId ? { ...r, ...updated } : r)));
      setRejectingId(null);
      setRejectRemarks("");
    } catch (err) {
      console.error("Failed to reject leave request:", err);
      alert(err.message || "Could not reject this leave request");
    } finally {
      setRejectSubmitting(false);
    }
  }

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleActingOfficerChange(option) {
    setForm((f) => ({ ...f, actingOfficerOption: option }));
  }

  const days = daysBetween(form.startDate, form.endDate);
  const needsLongJustification = form.leaveType === "annual" && days > 5;

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");

    if (!form.leaveType || !form.startDate || !form.endDate) {
      setFormError(t("leave.errFillCategoryDates"));
      return;
    }
    if (days <= 0) {
      setFormError(t("leave.errResumeDate"));
      return;
    }
    if (needsLongJustification && wordCount(form.justification) < 30) {
      setFormError(t("leave.errJustification"));
      return;
    }
    if (!form.actingOfficerOption) {
      setFormError(t("leave.errActingOfficerRequired"));
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
        actingOfficerId: form.actingOfficerOption.value,
      });
      setForm({
        leaveType: "",
        startDate: "",
        endDate: "",
        justification: "",
        emergencyContact: "",
        actingOfficerOption: null,
      });
      setView("history");
      await loadData();
    } catch (err) {
      setFormError(err.message || t("leave.errSubmitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const visibleRequests = useMemo(() => {
    const filtered =
      filterBy === "none" || !filterValue
        ? requests
        : requests.filter((r) => leaveSortKey(r, filterBy) === filterValue);

    return [...filtered].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  }, [requests, filterBy, filterValue]);

  function handleFilterByChange(next) {
    setFilterBy(next);
    setFilterValue("");
  }

  const historyColumns = [
    { key: "refId", label: t("leave.colRefId") },
    ...(isOic ? [{ key: "officerName", label: t("leave.colOfficer") }] : []),
    { key: "leaveType", label: t("leave.colLeaveType"), render: (r) => <span style={{ textTransform: "capitalize" }}>{r.leaveType}</span> },
    { key: "duration", label: t("leave.colDuration"), render: (r) => `${formatDate(r.startDate)} - ${formatDate(r.endDate)}` },
    { key: "days", label: t("leave.colDays") },
    { key: "status", label: t("common.status"), render: (r) => <Badge status={r.status} /> },
    { key: "remarks", label: t("leave.colRemarks") },
    ...(isOic
      ? [
          {
            key: "actions",
            label: t("common.actions"),
            render: (r) => (
              <div className="inline-actions">
                <button className="leave-action-btn view" onClick={() => openViewModal(r)}>{t("common.view")}</button>
                {r.status === "pending" && (
                  <>
                    <button className="leave-action-btn approve" onClick={() => handleApprove(r.id)}>{t("leave.approve")}</button>
                    <button className="leave-action-btn deny" onClick={() => openRejectModal(r.id)}>{t("leave.deny")}</button>
                  </>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  if (loading) return <Loader label={t("leave.loading")} />;

  if (view === "apply") {
    return (
      <div>
        <div className="leave-page-header">
          <h1>{t("leave.officialDocumentSubmission")}</h1>
        </div>

        <form className="leave-form-layout" onSubmit={handleSubmit}>
          <Card variant="panel">
            <h3 style={{ marginBottom: 4 }}>{t("leave.officerInformation")}</h3>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
              {t("leave.detailsAsPerCentral")}
            </p>

            <InputField label={t("leave.leaveCategory")} type="select" required value={form.leaveType}
              onChange={(e) => updateField("leaveType", e.target.value)} options={LEAVE_CATEGORY_OPTIONS} />

            <div className="leave-form-grid">
              <InputField label={t("leave.commencingDate")} type="date" required value={form.startDate}
                onChange={(e) => updateField("startDate", e.target.value)} min={todayISO()} />
              <InputField label={t("leave.resumingDate")} type="date" required value={form.endDate}
                onChange={(e) => updateField("endDate", e.target.value)} min={form.startDate || todayISO()} />
            </div>

            <div className="field-full">
              <InputField
                label={t("leave.detailedJustification")}
                type="textarea"
                value={form.justification}
                onChange={(e) => updateField("justification", e.target.value)}
                placeholder={t("leave.justificationPlaceholder")}
                helperText={needsLongJustification ? `${wordCount(form.justification)} / 30 ${t("leave.wordsMinimum")}` : undefined}
              />
            </div>

            <SearchableSelect
              label={t("leave.actingOfficer")}
              required
              value={form.actingOfficerOption}
              onChange={handleActingOfficerChange}
              searchFn={searchOfficers}
              placeholder={t("leave.searchOfficerPlaceholder")}
              helperText={t("leave.actingOfficerHelper")}
            />

            <InputField
              label={t("leave.emergencyContact")}
              type="tel"
              required
              value={form.emergencyContact}
              onChange={(e) => updateField("emergencyContact", e.target.value)}
              placeholder={t("leave.emergencyContactPlaceholder")}
            />

            <div className="consent-box">
              <input type="checkbox" required defaultChecked style={{ marginTop: 3 }} />
              <span>{t("leave.consentText")}</span>
            </div>

            {formError && <p style={{ color: "var(--color-danger)", marginBottom: 16 }}>{formError}</p>}

            <div className="form-actions">
              <Button variant="ghost" type="button" onClick={() => setView("history")}>
                {t("leave.discardDraft")}
              </Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? t("leave.submitting") : t("leave.submitApplication")}
              </Button>
            </div>
          </Card>

          <aside className="submission-rules-panel">
            <h3>{t("leave.submissionRules")}</h3>
            <p><strong>{t("leave.ruleAdvanceNoticeLabel")}</strong> {t("leave.ruleAdvanceNoticeText")}</p>
            <p><strong>{t("leave.ruleAnnualLeaveLabel")}</strong> {t("leave.ruleAnnualLeaveText")}</p>
            <p><strong>{t("leave.ruleMedicalLabel")}</strong> {t("leave.ruleMedicalText")}</p>
            <p><strong>{t("leave.ruleDutyHandoverLabel")}</strong> {t("leave.ruleDutyHandoverText")}</p>
            <p><strong>{t("leave.ruleBlackoutLabel")}</strong> {t("leave.ruleBlackoutText")}</p>
          </aside>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="leave-page-header">
        <h1>{t("leave.pageTitle")}</h1>
        <Button variant="outline" onClick={() => setView("apply")}>
          {t("leave.applyLeave")}
        </Button>
      </div>

      <div className="stat-grid">
        <StatCard label={t("leave.annualLeaves")} value={`${balance?.annual ?? 0} ${t("dashboard.days")}`} />
        <StatCard label={t("leave.sickLeaves")} value={`${balance?.sick ?? 0} ${t("dashboard.days")}`} />
        <StatCard label={t("leave.casualLeaves")} value={`${balance?.casual ?? 0} ${t("dashboard.days")}`} />
        <StatCard label={t("leave.pendingLeaves")} value={requests.filter((r) => r.status === "pending").length} />
      </div>

      <Card variant="panel">
        <div className="leave-sort-bar">
          <label htmlFor="leave-filter">{t("leave.view")}</label>
          <select
            id="leave-filter"
            className="leave-sort-select"
            value={filterBy}
            onChange={(e) => handleFilterByChange(e.target.value)}
          >
            <option value="none">{t("leave.allLeaves")}</option>
            <option value="date">{t("leave.aSpecificDate")}</option>
            <option value="week">{t("leave.aSpecificWeek")}</option>
            <option value="month">{t("leave.aSpecificMonth")}</option>
            <option value="year">{t("leave.aSpecificYear")}</option>
          </select>

          {filterBy === "date" && (
            <input
              type="date"
              className="leave-sort-select"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
            />
          )}
          {filterBy === "week" && (
            <input
              type="week"
              className="leave-sort-select"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
            />
          )}
          {filterBy === "month" && (
            <input
              type="month"
              className="leave-sort-select"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
            />
          )}
          {filterBy === "year" && (
            <input
              type="number"
              className="leave-sort-select"
              style={{ width: 90 }}
              placeholder="e.g. 2026"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
            />
          )}
        </div>
        <Table
          columns={historyColumns}
          data={visibleRequests}
          emptyMessage={filterBy !== "none" && filterValue ? t("leave.noRequestsInPeriod") : t("leave.noRequestsYet")}
        />
      </Card>

      <Modal
        open={rejectingId !== null}
        onClose={() => setRejectingId(null)}
        title={t("leave.rejectModalTitle")}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setRejectingId(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={handleReject} disabled={rejectSubmitting || !rejectRemarks.trim()}>
              {rejectSubmitting ? t("leave.rejecting") : t("leave.rejectRequest")}
            </Button>
          </>
        }
      >
        <InputField
          label={t("leave.reasonForRejection")}
          type="textarea"
          required
          value={rejectRemarks}
          onChange={(e) => setRejectRemarks(e.target.value)}
          placeholder={t("leave.reasonForRejectionPlaceholder")}
        />
      </Modal>

      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={t("leave.viewDetailsTitle")}
      >
        {viewing && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 16 }}>
              <div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.colOfficer")}</p>
                <p>{viewing.officerName}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.department")}</p>
                <p>{officers.find((o) => o.id === viewing.officerId)?.department || "—"}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.colLeaveType")}</p>
                <p style={{ textTransform: "capitalize" }}>{viewing.leaveType}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.colDuration")}</p>
                <p>{formatDate(viewing.startDate)} - {formatDate(viewing.endDate)} ({viewing.days} {t("dashboard.days")})</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("common.status")}</p>
                <Badge status={viewing.status} />
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.actingOfficer")}</p>
                <p>{officers.find((o) => o.id === viewing.actingOfficerId)?.fullName || "—"}</p>
              </div>
            </div>

            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.justificationReason")}</p>
            <p style={{ marginBottom: 16 }}>{viewing.justification || t("leave.noJustificationProvided")}</p>

            {viewing.remarks && (
              <>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.colRemarks")}</p>
                <p style={{ marginBottom: 16 }}>{viewing.remarks}</p>
              </>
            )}

            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>{t("leave.leaveBalance")}</p>
            {viewBalanceLoading ? (
              <p style={{ color: "var(--color-text-muted)" }}>{t("leave.loadingBalance")}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                <div>
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("leave.annualLeaves")}</p>
                  <p>{viewBalance?.annual ?? 0} {t("dashboard.days")}</p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("leave.sickLeaves")}</p>
                  <p>{viewBalance?.sick ?? 0} {t("dashboard.days")}</p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{t("leave.casualLeaves")}</p>
                  <p>{viewBalance?.casual ?? 0} {t("dashboard.days")}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}