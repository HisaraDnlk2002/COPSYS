import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, Badge, Loader, Modal } from "../../components";
import {
  getRosterWeeks,
  getRosterWeek,
  createRosterWeek,
  deleteRosterWeek,
  generateRoster,
  submitRosterWeek,
  approveRosterWeek,
  sendBackRosterWeek,
  publishRosterWeek,
  createDutyShift,
  updateDutyShift,
  DAYS_OF_WEEK,
} from "../../services/dutyRoster";
import { listUsers } from "../../services/users";
import { getAllLeaveRequests } from "../../services/leave";
import { isGeneralPoolBranch } from "../../config/branches";
import { CreateRosterWizard } from "./CreateRosterWizard";
import { DailyDutyUpdate } from "./DailyDutyUpdate";
import "./DutyRoster.css";

const DEFAULT_SHIFT_START = "08:00";
const DEFAULT_SHIFT_END = "20:00";

function shortDay(day) {
  return day.slice(0, 3);
}

// Monday-of-week string + day index -> ISO date string, so manual
// assignment cells know which actual date they're writing to.
function dateForDayIndex(weekStarting, dayIndex) {
  const d = new Date(weekStarting);
  d.setDate(d.getDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}

function overlapsWeek(leave, weekStarting) {
  const weekStart = new Date(weekStarting).setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStarting);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const end = weekEnd.setHours(0, 0, 0, 0);
  const start = new Date(leave.startDate).setHours(0, 0, 0, 0);
  const finish = new Date(leave.endDate).setHours(0, 0, 0, 0);
  return start <= end && finish >= weekStart;
}

export function DutyRosterPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isDutyOfficer = user?.role === "duty_officer";
  const isOic = user?.role === "oic";

  const [activeTab, setActiveTab] = useState("weekly"); // "weekly" | "daily"
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  const [weekDetail, setWeekDetail] = useState(null); // { week, shifts }
  const [officers, setOfficers] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);

  const [showWizard, setShowWizard] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [unfilledDays, setUnfilledDays] = useState([]);

  const [sendBackReason, setSendBackReason] = useState("");
  const [showSendBackModal, setShowSendBackModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRosterWeeks(), listUsers(), getAllLeaveRequests()])
      .then(([weeksRes, usersRes, leaveRes]) => {
        if (cancelled) return;
        setWeeks(weeksRes);
        setOfficers(usersRes);
        setLeaveRequests(leaveRes.filter((l) => l.status === "approved"));
        if (weeksRes.length > 0) setSelectedWeekId(weeksRes[0].id);
      })
      .catch((err) => console.error("Failed to load duty roster page data:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function refreshSelectedWeek() {
    if (!selectedWeekId) return;
    getRosterWeek(selectedWeekId)
      .then((res) => setWeekDetail(res))
      .catch((err) => console.error("Failed to load week detail:", err));
  }

  useEffect(() => {
    refreshSelectedWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekId]);

  async function handleGenerate() {
    if (!selectedWeekId) return;
    setGenerating(true);
    try {
      const result = await generateRoster(selectedWeekId);
      setUnfilledDays(result.unfilledDays || []);
      refreshSelectedWeek();
    } catch (err) {
      console.error("Generate roster failed:", err);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmitWeek() {
    if (!selectedWeekId) return;
    try {
      const updated = await submitRosterWeek(selectedWeekId);
      setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
    } catch (err) {
      console.error("Could not submit week:", err);
    }
  }

  async function handleApproveWeek() {
    if (!selectedWeekId) return;
    try {
      const updated = await approveRosterWeek(selectedWeekId);
      setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
    } catch (err) {
      console.error("Could not approve week:", err);
    }
  }

  async function handleSendBack() {
    if (!selectedWeekId) return;
    try {
      const updated = await sendBackRosterWeek(selectedWeekId, sendBackReason);
      setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
    } catch (err) {
      console.error("Could not send back week:", err);
    } finally {
      setShowSendBackModal(false);
      setSendBackReason("");
    }
  }

  async function handleDeleteWeek(weekId, e) {
    e.stopPropagation(); // don't also trigger selecting the row
    if (!window.confirm(t("dutyRoster.confirmDeleteDraft"))) return;
    try {
      await deleteRosterWeek(weekId);
      setWeeks((prev) => prev.filter((w) => w.id !== weekId));
      if (selectedWeekId === weekId) {
        setSelectedWeekId(null);
        setWeekDetail(null);
      }
    } catch (err) {
      console.error("Could not delete week:", err);
    }
  }

  async function handlePublishWeek() {
    if (!selectedWeekId) return;
    try {
      const updated = await publishRosterWeek(selectedWeekId);
      setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
    } catch (err) {
      console.error("Could not publish week:", err);
    }
  }

  // Manual grid editing: only while the Duty Officer can still change
  // things (draft, or sent back for revision).
  const isEditableStatus = ["draft", "sent_back"].includes(weekDetail?.week?.status);

  async function handleCellClick(officer, dayIndex, existingShift) {
    if (!isDutyOfficer || !isEditableStatus || !weekDetail?.week) return;

    if (existingShift) {
      // Toggle off — manual correction, not a "replacement" (that's the
      // Daily tab's job for actual absences on a specific day).
      try {
        await updateDutyShift(existingShift.id, { status: "removed" });
        refreshSelectedWeek();
      } catch (err) {
        console.error("Could not remove assignment:", err);
      }
      return;
    }

    // A permanent officer works their own branch. A General Pool officer
    // only has an unambiguous target branch to manually assign into when
    // this week is planning exactly one branch — otherwise, use the
    // wizard's Smart Allocation instead, which knows which branch needs them.
    const targetBranch = plannedBranches.includes(officer.department)
      ? officer.department
      : plannedBranches.length === 1
      ? plannedBranches[0]
      : null;

    if (!targetBranch) {
      console.warn("Can't infer a target branch for this General Pool officer in a multi-branch week — use Smart Allocation in the wizard instead.");
      return;
    }

    try {
      await createDutyShift({
        weekId: weekDetail.week.id,
        officerId: officer.id,
        date: dateForDayIndex(weekDetail.week.weekStarting, dayIndex),
        shiftStart: DEFAULT_SHIFT_START,
        shiftEnd: DEFAULT_SHIFT_END,
        department: targetBranch,
      });
      refreshSelectedWeek();
    } catch (err) {
      console.error("Could not add assignment:", err);
    }
  }

  if (loading) return <Loader label={t("dutyRoster.loading")} />;

  const selectedWeek = weeks.find((w) => w.id === selectedWeekId);
  const detailLoading = Boolean(selectedWeekId) && weekDetail?.week?.id !== selectedWeekId;

  // Only removed/cancelled cells are hidden — everything else counts.
  const activeShifts = (weekDetail?.shifts || []).filter((s) => s.status !== "removed");
  const shiftsByOfficerAndDay = {};
  activeShifts.forEach((s) => {
    // Populated officerId sub-documents don't get the custom toJSON()
    // that adds `.id` — only top-level User docs do. Fall back to _id.
    const officerKey = typeof s.officerId === "object" ? (s.officerId.id || s.officerId._id) : s.officerId;
    const dayKey = s.day || DAYS_OF_WEEK[new Date(s.date).getDay() === 0 ? 6 : new Date(s.date).getDay() - 1];
    shiftsByOfficerAndDay[`${officerKey}-${dayKey}`] = s;
  });

  // A week now spans every branch in its requirements list (post-wizard
  // model), not one branch. Eligible rows: permanent officers of ANY
  // planned branch, plus the General Pool (spec §4/§6).
  const plannedBranches = selectedWeek?.requirements?.map((r) => r.branch) || [];

  const rosterOfficers = selectedWeek
    ? officers
        .filter(
          (o) =>
            o.status === "active" &&
            (plannedBranches.includes(o.department) || isGeneralPoolBranch(o.department))
        )
        .sort((a, b) => {
          const aGeneral = isGeneralPoolBranch(a.department) ? 1 : 0;
          const bGeneral = isGeneralPoolBranch(b.department) ? 1 : 0;
          return aGeneral - bGeneral || a.fullName.localeCompare(b.fullName);
        })
    : [];

  const officersOnLeaveThisWeek = selectedWeek
    ? leaveRequests.filter((l) => overlapsWeek(l, selectedWeek.weekStarting))
    : [];

  function statusLabel(status) {
    const key = `status.${(status || "").toLowerCase()}`;
    const translated = t(key);
    return translated === key ? status : translated;
  }

  return (
    <div>
      <div className="roster-header">
        <h1>{t("dutyRoster.title")} {isOic ? t("dutyRoster.management") : t("dutyRoster.dashboard")}</h1>
        {activeTab === "weekly" && isDutyOfficer && (
          <Button variant="primary" onClick={() => setShowWizard((v) => !v)}>
            {showWizard ? t("dutyRoster.cancel") : t("dutyRoster.newRosterWeek")}
          </Button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "1px solid var(--color-border, #e5e7eb)" }}>
        {["weekly", "daily"].map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setActiveTab(tabKey)}
            style={{
              background: "none",
              border: "none",
              padding: "10px 16px",
              cursor: "pointer",
              fontWeight: activeTab === tabKey ? 600 : 400,
              borderBottom: activeTab === tabKey ? "2px solid var(--color-primary, #1d4ed8)" : "2px solid transparent",
              color: activeTab === tabKey ? "var(--color-primary, #1d4ed8)" : "inherit",
            }}
          >
            {tabKey === "weekly" ? t("dutyRoster.tabWeekly") : t("dutyRoster.tabDaily")}
          </button>
        ))}
      </div>

      {activeTab === "daily" && <DailyDutyUpdate />}

      {activeTab === "weekly" && (
        <>
      {showWizard && (
        <CreateRosterWizard
          onCancel={() => setShowWizard(false)}
          onComplete={(newWeekId) => {
            setShowWizard(false);
            getRosterWeeks()
              .then((res) => {
                setWeeks(res);
                setSelectedWeekId(newWeekId);
              })
              .catch((err) => console.error("Could not refresh weeks after wizard:", err));
          }}
        />
      )}

      <div className="roster-weeks-list">
        {weeks.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>{t("dutyRoster.noRosterWeeks")}</p>}
        {weeks.map((week) => (
          <div
            key={week.id}
            className={`roster-week-row${week.id === selectedWeekId ? " active" : ""}`}
            onClick={() => setSelectedWeekId(week.id)}
          >
            <span>
              {t("dutyRoster.weekOf")} {week.weekStarting}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge status={week.status === "sent_back" ? "rejected" : week.status === "submitted" ? "pending" : week.status} />
              {isDutyOfficer && week.status === "draft" && (
                <Button variant="ghost" onClick={(e) => handleDeleteWeek(week.id, e)}>
                  {t("dutyRoster.delete")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedWeek && (
        <div className="roster-content-layout" style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <Card variant="panel" style={{ flex: 1 }}>
            {unfilledDays.length > 0 && (
              <div className="unfilled-warning">
                {t("dutyRoster.couldNotFullyStaff")} {unfilledDays.map((d) => `${d.day} (${t("dutyRoster.short")} ${d.shortfall})`).join(", ")}.
                {" "}{t("dutyRoster.reviewAdjust")}
              </div>
            )}

            {selectedWeek.status === "sent_back" && selectedWeek.sendBackReason && (
              <div className="unfilled-warning">
                {t("dutyRoster.sentBackByOic")} {selectedWeek.sendBackReason}
              </div>
            )}

            {isDutyOfficer && isEditableStatus && (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 12 }}>
                {t("dutyRoster.editHint")}
              </p>
            )}

            {detailLoading ? (
              <Loader label={t("dutyRoster.loadingWeekGrid")} />
            ) : rosterOfficers.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)" }}>{t("dutyRoster.noEligibleOfficers")}</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="roster-grid-table">
                  <thead>
                    <tr>
                      <th>{t("dutyRoster.officer")}</th>
                      {DAYS_OF_WEEK.map((day) => (
                        <th key={day}>{shortDay(day)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rosterOfficers.map((officer) => (
                      <tr key={officer.id}>
                        <td>
                          {officer.fullName}
                          {isGeneralPoolBranch(officer.department) && (
                            <Badge status="general_pool" label={t("dutyRoster.generalPool")} />
                          )}
                        </td>
                        {DAYS_OF_WEEK.map((day, dayIndex) => {
                          const shift = shiftsByOfficerAndDay[`${officer.id}-${day}`];
                          const code = shift ? (shift.assignmentType === "GENERAL_POOL" ? "pool" : "p") : "empty";
                          const clickable = isDutyOfficer && isEditableStatus;
                          return (
                            <td key={day}>
                              <span
                                className={`roster-cell ${code}${clickable ? " clickable" : ""}`}
                                title={
                                  shift
                                    ? `${shift.shiftStart}-${shift.shiftEnd} ${shift.department}${shift.assignmentType === "GENERAL_POOL" ? ` (${t("dutyRoster.generalPool")})` : ""}`
                                    : t("dutyRoster.off")
                                }
                                onClick={() => handleCellClick(officer, dayIndex, shift)}
                              >
                                {code === "empty" ? "" : "P"}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="roster-footer-stats">
              <div className="roster-footer-stat">
                <div className="value">{activeShifts.length ? new Set(activeShifts.map((s) => (typeof s.officerId === "object" ? (s.officerId.id || s.officerId._id) : s.officerId))).size : 0}/{rosterOfficers.length}</div>
                <div className="label">{t("dutyRoster.scheduledUnits")}</div>
              </div>
              <div className="roster-footer-stat">
                <div className="value">{officersOnLeaveThisWeek.length}</div>
                <div className="label">{t("dutyRoster.leaveCoverage")}</div>
              </div>
              <div className="roster-footer-stat">
                <div className="value">{statusLabel(selectedWeek.status)}</div>
                <div className="label">{t("dutyRoster.status")}</div>
              </div>
            </div>

            {isDutyOfficer && selectedWeek.status === "draft" && (
              <div className="roster-actions-row">
                <Button variant="outline" onClick={handleGenerate} disabled={generating}>
                  {generating ? t("dutyRoster.generating") : t("dutyRoster.generateRoster")}
                </Button>
                <Button variant="primary" onClick={handleSubmitWeek}>
                  {t("dutyRoster.submitToOic")}
                </Button>
              </div>
            )}

            {isDutyOfficer && selectedWeek.status === "sent_back" && (
              <div className="roster-actions-row">
                <Button variant="primary" onClick={handleSubmitWeek}>
                  {t("dutyRoster.submitToOic")}
                </Button>
              </div>
            )}

            {isOic && selectedWeek.status === "submitted" && (
              <div className="roster-actions-row">
                <Button variant="ghost" onClick={() => setShowSendBackModal(true)}>
                  {t("dutyRoster.sendBackToRevise")}
                </Button>
                <Button variant="primary" onClick={handleApproveWeek}>
                  {t("dutyRoster.approve")}
                </Button>
              </div>
            )}

            {isDutyOfficer && selectedWeek.status === "approved" && (
              <div className="roster-actions-row">
                <Button variant="primary" onClick={handlePublishWeek}>
                  {t("dutyRoster.publish")}
                </Button>
              </div>
            )}
          </Card>

          <Card variant="panel" style={{ width: 280, flexShrink: 0 }}>
            <h3 style={{ marginTop: 0 }}>{t("dutyRoster.officersOnLeave")}</h3>
            {officersOnLeaveThisWeek.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{t("dutyRoster.noOneOnLeave")}</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {officersOnLeaveThisWeek.map((l) => (
                  <li key={l.id} style={{ marginBottom: 12, fontSize: 13 }}>
                    <div style={{ fontWeight: 600 }}>{l.officerName}</div>
                    <div style={{ color: "var(--color-text-muted)" }}>
                      {l.leaveType} · {new Date(l.startDate).toLocaleDateString()} – {new Date(l.endDate).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={showSendBackModal}
        onClose={() => setShowSendBackModal(false)}
        title={t("dutyRoster.sendBackModalTitle")}
        footer={
          <Button variant="primary" onClick={handleSendBack}>
            {t("dutyRoster.sendBack")}
          </Button>
        }
      >
        <InputField
          label={t("dutyRoster.reason")}
          type="textarea"
          value={sendBackReason}
          onChange={(e) => setSendBackReason(e.target.value)}
          placeholder={t("dutyRoster.reasonPlaceholder")}
        />
      </Modal>
        </>
      )}
    </div>
  );
}