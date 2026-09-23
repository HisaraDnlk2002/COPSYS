import { useState } from "react";
import { Button, Modal, Loader, InputField } from "../../components";
import { isGeneralPoolBranch } from "../../config/branches";
import { createDutyShift, updateDutyShift } from "../../services/dutyRoster";
import { useLanguage } from "../../i18n/useLanguage";

// Spec §8 — what the shift's actual task is, distinct from which branch
// it's under. Free text on the model, but offered as a short pick-list
// here so it stays consistent rather than every Duty Officer typing
// their own phrasing; "Other" (left as a blank custom entry) covers
// anything not on the list.
const DUTY_TYPES = [
  "Traffic Control",
  "Traffic Patrol",
  "Station Duty",
  "Front Desk",
  "Investigation",
  "Patrol",
  "Night Watch",
  "Escort",
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function branchLabel(value) {
  return value ? value.split(" (")[0] : "";
}

function shortOfficerName(fullName) {
  if (!fullName) return "";
  const parts = fullName.trim().split(" ");
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function dateForDayIndex(weekStarting, dayIndex) {
  const d = new Date(weekStarting);
  d.setDate(d.getDate() + dayIndex);
  return d;
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function officerOnLeave(officerId, date, leaveRequests) {
  return leaveRequests.some((l) => {
    if (l.officerId !== officerId && l.officer_id !== officerId) return false;
    const day = new Date(date).setHours(0, 0, 0, 0);
    const start = new Date(l.startDate).setHours(0, 0, 0, 0);
    const end = new Date(l.endDate).setHours(0, 0, 0, 0);
    return day >= start && day <= end;
  });
}

function ShiftChip({ shift, hasDoubleShift, onLeave, editable, onRemove, t }) {
  const isPool = shift.assignmentType === "GENERAL_POOL";
  const isSubstitute = shift.assignmentType === "SUBSTITUTE";
  const isAbsent = shift.status === "absent";
  // Spec §10 — an absence caused by approved leave reads as "On Leave",
  // distinct from a genuine unplanned no-show ("Absent"), even though
  // both share the same underlying status — see DutySchedule.js's
  // absenceReason comment for why they're still one status value.
  const isOnLeaveAbsence = isAbsent && shift.absenceReason === "leave";
  const officer = typeof shift.officerId === "object" ? shift.officerId : null;
  const substituteForOfficer = typeof shift.substituteFor === "object" ? shift.substituteFor : null;

  return (
    <div
      title={
        isOnLeaveAbsence
          ? t("dutyRoster.grid.onLeaveTooltip")
          : isAbsent
          ? t("dutyRoster.grid.absentTooltip")
          : onLeave
          ? t("dutyRoster.grid.leaveConflictTooltip")
          : hasDoubleShift
          ? t("dutyRoster.grid.doubleShiftTooltip")
          : isSubstitute && substituteForOfficer
          ? `${officer?.fullName || ""} ${t("dutyRoster.grid.substituteForPrefix")} ${substituteForOfficer.fullName}`
          : `${officer?.fullName || ""} · ${shift.shiftStart}-${shift.shiftEnd}${shift.dutyType ? ` · ${shift.dutyType}` : ""}`
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        padding: "2px 6px",
        borderRadius: 4,
        marginBottom: 3,
        background: isOnLeaveAbsence
          ? "var(--color-warning-bg, #fef3c7)"
          : isAbsent
          ? "var(--color-danger-bg, #fee2e2)"
          : onLeave || hasDoubleShift
          ? "var(--color-warning-bg, #fef3c7)"
          : isPool || isSubstitute
          ? "var(--color-info-bg, #dbeafe)"
          : "var(--color-success-bg, #dcfce7)",
        color: isOnLeaveAbsence
          ? "var(--color-warning, #d97706)"
          : isAbsent
          ? "var(--color-danger, #dc2626)"
          : onLeave || hasDoubleShift
          ? "var(--color-warning, #d97706)"
          : isPool || isSubstitute
          ? "var(--color-info, #2563eb)"
          : "var(--color-success, #16a34a)",
        cursor: editable && !isAbsent ? "pointer" : "default",
      }}
      onClick={() => editable && !isAbsent && onRemove(shift)}
    >
      {(onLeave || hasDoubleShift) && <span>⚠</span>}
      <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
        {shortOfficerName(officer?.fullName)}
      </span>
      <span style={{ opacity: 0.75, textTransform: "uppercase", fontSize: 9 }}>
        {isOnLeaveAbsence
          ? t("status.on_leave")
          : isAbsent
          ? t("dutyRoster.grid.absentTag")
          : isSubstitute
          ? t("dutyRoster.grid.substituteTag")
          : isPool
          ? t("dutyRoster.grid.poolTag")
          : t("dutyRoster.grid.permTag")}
      </span>
    </div>
  );
}

function ShiftBlock({
  branch,
  shiftType,
  required,
  date,
  shiftsForSlot,
  hasDoubleShiftMap,
  leaveRequests,
  editable,
  onRemove,
  onOpenAssign,
  t,
}) {
  const assignedCount = shiftsForSlot.filter((s) => s.status !== "absent").length;
  const short = assignedCount < required;

  return (
    <div
      style={{
        border: `1px solid ${short ? "var(--color-danger, #dc2626)" : "var(--color-border, #e5e7eb)"}`,
        borderRadius: 6,
        padding: 6,
        marginBottom: 6,
        minWidth: 110,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
        <span>{shiftType === "day" ? t("dutyRoster.wizard.dayReq") : t("dutyRoster.wizard.nightReq")}</span>
        <span style={{ color: short ? "var(--color-danger, #dc2626)" : "var(--color-text-muted)" }}>
          {assignedCount}/{required}
        </span>
      </div>

      {shiftsForSlot.map((shift) => {
        const officerId = typeof shift.officerId === "object" ? shift.officerId.id || shift.officerId._id : shift.officerId;
        return (
          <ShiftChip
            key={shift.id}
            shift={shift}
            onLeave={officerOnLeave(officerId, date, leaveRequests)}
            hasDoubleShift={hasDoubleShiftMap.has(officerId)}
            editable={editable}
            onRemove={onRemove}
            t={t}
          />
        );
      })}

      {editable && (
        <button
          onClick={() => onOpenAssign({ branch, shiftType, date })}
          style={{
            width: "100%",
            border: "1px dashed var(--color-border, #e5e7eb)",
            borderRadius: 4,
            background: "none",
            color: "var(--color-primary, #1d4ed8)",
            fontSize: 11,
            padding: "2px 0",
            cursor: "pointer",
            marginTop: 2,
          }}
        >
          {t("dutyRoster.grid.assignPlus")}
        </button>
      )}
    </div>
  );
}

export function WeeklyGrid({ week, shifts, officers, leaveRequests, editable, onChanged }) {
  const { t } = useLanguage();
  const [assignTarget, setAssignTarget] = useState(null); // { branch, shiftType, date }
  const [assignDutyType, setAssignDutyType] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null); // the shift pending removal (spec §13 — reason required)
  const [removeReason, setRemoveReason] = useState("");
  const [removing, setRemoving] = useState(false);

  const requirements = week.requirements || [];

  // date -> officerId -> Set(shiftType) to flag anyone double-booked
  // across day+night the same date (spec §14).
  const hasDoubleShiftByDate = new Map();
  shifts.forEach((s) => {
    if (s.status === "absent") return;
    const officerId = typeof s.officerId === "object" ? s.officerId.id || s.officerId._id : s.officerId;
    const dateKey = isoDate(s.date);
    if (!hasDoubleShiftByDate.has(dateKey)) hasDoubleShiftByDate.set(dateKey, new Map());
    const officerShiftTypes = hasDoubleShiftByDate.get(dateKey);
    if (!officerShiftTypes.has(officerId)) officerShiftTypes.set(officerId, new Set());
    officerShiftTypes.get(officerId).add(s.shiftType);
  });

  function doubleShiftSetFor(dateKey) {
    const officerShiftTypes = hasDoubleShiftByDate.get(dateKey);
    if (!officerShiftTypes) return new Set();
    const result = new Set();
    officerShiftTypes.forEach((types, officerId) => {
      if (types.size > 1) result.add(officerId);
    });
    return result;
  }

  // Spec §13 — opens the confirm-with-reason modal rather than removing
  // immediately; handleConfirmRemove below is what actually calls the
  // API once a reason's been given.
  function handleRemove(shift) {
    setRemoveTarget(shift);
    setRemoveReason("");
  }

  async function handleConfirmRemove() {
    if (!removeTarget || !removeReason.trim()) return;
    setRemoving(true);
    try {
      await updateDutyShift(removeTarget.id, { status: "removed", removalReason: removeReason.trim() });
      setRemoveTarget(null);
      setRemoveReason("");
      onChanged();
    } catch (err) {
      console.error("Could not remove assignment:", err);
    } finally {
      setRemoving(false);
    }
  }

  async function handleAssignOfficer(officer) {
    if (!assignTarget) return;
    setAssigning(true);
    try {
      const { shiftStart, shiftEnd } = assignTarget.shiftType === "night"
        ? { shiftStart: "20:00", shiftEnd: "08:00" }
        : { shiftStart: "08:00", shiftEnd: "20:00" };
      await createDutyShift({
        weekId: week.id,
        officerId: officer.id,
        date: isoDate(assignTarget.date),
        shiftStart,
        shiftEnd,
        shiftType: assignTarget.shiftType,
        department: assignTarget.branch,
        dutyType: assignDutyType,
      });
      setAssignTarget(null);
      setAssignDutyType("");
      onChanged();
    } catch (err) {
      console.error("Could not assign officer:", err);
    } finally {
      setAssigning(false);
    }
  }

  function eligibleOfficersFor(branch, date) {
    const dateKey = isoDate(date);
    const alreadyWorkingIds = new Set();
    shifts.forEach((s) => {
      if (s.status === "absent") return;
      if (isoDate(s.date) !== dateKey) return;
      const officerId = typeof s.officerId === "object" ? s.officerId.id || s.officerId._id : s.officerId;
      alreadyWorkingIds.add(officerId);
    });

    return officers.filter(
      (o) =>
        o.status === "active" &&
        (o.department === branch || isGeneralPoolBranch(o.department)) &&
        !alreadyWorkingIds.has(o.id) &&
        !officerOnLeave(o.id, date, leaveRequests)
    );
  }

  if (requirements.length === 0) {
    return <p style={{ color: "var(--color-text-muted)" }}>{t("dutyRoster.grid.noRequirements")}</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="roster-grid-table" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 140 }}>{t("dutyRoster.departmentUnit")}</th>
            {DAY_NAMES.map((day, i) => {
              const date = dateForDayIndex(week.weekStarting, i);
              return (
                <th key={day} style={{ minWidth: 130 }}>
                  {date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {requirements.map((req) => (
            <tr key={req.branch}>
              <td style={{ verticalAlign: "top" }}>
                <div style={{ fontWeight: 600 }}>{branchLabel(req.branch)}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  {t("dutyRoster.grid.minReq")} {req.dayRequired}D / {req.nightRequired}N
                </div>
              </td>
              {DAY_NAMES.map((day, dayIndex) => {
                const date = dateForDayIndex(week.weekStarting, dayIndex);
                const dateKey = isoDate(date);
                const doubleShiftSet = doubleShiftSetFor(dateKey);
                const shiftsForDay = shifts.filter(
                  (s) => s.department === req.branch && isoDate(s.date) === dateKey
                );

                return (
                  <td key={day} style={{ verticalAlign: "top" }}>
                    {req.dayRequired > 0 && (
                      <ShiftBlock
                        branch={req.branch}
                        shiftType="day"
                        required={req.dayRequired}
                        date={date}
                        shiftsForSlot={shiftsForDay.filter((s) => s.shiftType === "day")}
                        hasDoubleShiftMap={doubleShiftSet}
                        leaveRequests={leaveRequests}
                        editable={editable}
                        onRemove={handleRemove}
                        onOpenAssign={setAssignTarget}
                        t={t}
                      />
                    )}
                    {req.nightRequired > 0 && (
                      <ShiftBlock
                        branch={req.branch}
                        shiftType="night"
                        required={req.nightRequired}
                        date={date}
                        shiftsForSlot={shiftsForDay.filter((s) => s.shiftType === "night")}
                        hasDoubleShiftMap={doubleShiftSet}
                        leaveRequests={leaveRequests}
                        editable={editable}
                        onRemove={handleRemove}
                        onOpenAssign={setAssignTarget}
                        t={t}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <Modal
        open={Boolean(assignTarget)}
        onClose={() => setAssignTarget(null)}
        title={t("dutyRoster.grid.assignModalTitle")}
      >
        {assignTarget && (
          <>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
              {branchLabel(assignTarget.branch)} ·{" "}
              {assignTarget.shiftType === "night" ? t("dutyRoster.wizard.nightShift") : t("dutyRoster.wizard.dayShift")} ·{" "}
              {new Date(assignTarget.date).toLocaleDateString()}
            </p>
            <InputField
              label={t("dutyRoster.grid.dutyType")}
              type="select"
              value={assignDutyType}
              onChange={(e) => setAssignDutyType(e.target.value)}
              placeholder={t("dutyRoster.grid.dutyTypeUnspecified")}
              options={DUTY_TYPES.map((v) => ({ value: v, label: v }))}
              helperText={t("dutyRoster.grid.dutyTypeHelper")}
            />
            {assigning ? (
              <Loader label={t("dutyRoster.grid.assigning")} />
            ) : (
              (() => {
                const candidates = eligibleOfficersFor(assignTarget.branch, assignTarget.date);
                if (candidates.length === 0) {
                  return <p style={{ color: "var(--color-text-muted)" }}>{t("dutyRoster.grid.noEligibleForSlot")}</p>;
                }
                return (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {candidates.map((officer) => (
                      <li
                        key={officer.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px 0",
                          borderBottom: "1px solid var(--color-border, #e5e7eb)",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>{officer.fullName}</div>
                          {isGeneralPoolBranch(officer.department) && (
                            <div style={{ fontSize: 11, color: "var(--color-info, #2563eb)" }}>{t("dutyRoster.generalPool")}</div>
                          )}
                        </div>
                        <Button variant="outline" onClick={() => handleAssignOfficer(officer)}>
                          {t("dutyRoster.assign")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                );
              })()
            )}
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={t("dutyRoster.grid.removeModalTitle")}
        footer={
          <Button variant="primary" onClick={handleConfirmRemove} disabled={!removeReason.trim() || removing}>
            {removing ? t("dutyRoster.grid.removing") : t("dutyRoster.grid.removeConfirm")}
          </Button>
        }
      >
        {removeTarget && (
          <>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
              {shortOfficerName(
                typeof removeTarget.officerId === "object" ? removeTarget.officerId.fullName : ""
              )}{" "}
              · {branchLabel(removeTarget.department)} · {new Date(removeTarget.date).toLocaleDateString()}
            </p>
            <InputField
              label={t("dutyRoster.grid.removalReasonLabel")}
              required
              type="select"
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              placeholder={t("dutyRoster.grid.selectReason")}
              options={[
                "Leave",
                "Replacement",
                "Operational Change",
                "Shift Change",
                "OIC Instruction",
                "Other",
              ].map((v) => ({ value: v, label: t(`dutyRoster.grid.removalReasonOptions.${v.replace(/\s+/g, "")}`) }))}
            />
          </>
        )}
      </Modal>
    </div>
  );
}