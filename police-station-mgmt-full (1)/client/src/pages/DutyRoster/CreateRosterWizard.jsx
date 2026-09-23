import { Fragment, useEffect, useState } from "react";
import { Button, InputField, Card, Badge, Loader } from "../../components";
import {
  createRosterWeek,
  updateWeekRequirements,
  getStaffingOverview,
  getRosterWeek,
  generateRoster,
} from "../../services/dutyRoster";
import { BRANCHES } from "../../config/branches";
import { useLanguage } from "../../i18n/useLanguage";

const PLANNABLE_BRANCHES = BRANCHES.filter((b) => !b.isGeneralPool);

// Merges a week's already-saved requirements into the full branch list,
// so every branch shows a row (0s where nothing's been set yet) whether
// we're starting fresh or re-opening an existing draft.
function buildRequirements(existingWeek) {
  const saved = existingWeek?.requirements || [];
  return PLANNABLE_BRANCHES.map((b) => {
    const match = saved.find((r) => r.branch === b.value);
    return {
      branch: b.value,
      dayRequired: match?.dayRequired || 0,
      nightRequired: match?.nightRequired || 0,
    };
  });
}
function shortBranchLabel(value) {
  // "Traffic Branch (ගමනාගමන අංශය)" -> "Traffic Branch"
  return value.split(" (")[0];
}

// Spec §7 — turns one candidateNotes entry (see dutyAllocationEngine.js's
// summarizeReason) into a translated label. The server sends reasonCode
// as the canonical value and an English reasonLabel as a fallback for
// any code this client build doesn't recognize yet; the two dynamic
// codes (partial-week ones) compose their day counts client-side rather
// than needing string interpolation inside t() (this app's t() only
// ever takes a plain path — see other "compose around t()" call sites
// like Inventory.jsx's issue-record prefill caption).
function translateReasonNote(t, note) {
  switch (note.reasonCode) {
    case "selected_full_week":
      return t("dutyRoster.wizard.reasonSelectedFullWeek");
    case "selected_partial_week":
      return `${t("dutyRoster.wizard.reasonSelectedPartialWeekPrefix")} ${note.daysSelected}/7 ${t("dutyRoster.wizard.reasonDaysSuffix")}`;
    case "on_leave":
      return t("dutyRoster.wizard.reasonOnLeave");
    case "on_leave_partial":
      return `${t("dutyRoster.wizard.reasonOnLeavePartialPrefix")} ${note.daysExcludedLeave} ${t("dutyRoster.wizard.reasonOnLeavePartialSuffix")}`;
    case "rest_limit":
      return t("dutyRoster.wizard.reasonRestLimit");
    case "already_committed":
      return t("dutyRoster.wizard.reasonAlreadyCommitted");
    case "rotation_deprioritized":
      return t("dutyRoster.wizard.reasonRotationDeprioritized");
    case "not_needed":
      return t("dutyRoster.wizard.reasonNotNeeded");
    default:
      return note.reasonLabel;
  }
}

// Earliest date "Select Week" will let the Duty Officer pick — the later
// of today and the day right after the most recently created roster
// week's own start. Stops the calendar from being clickable on a week
// that's already been created (or any date before today), rather than
// only catching a backward pick after the fact via a server error.
//
// Built entirely in UTC, not local time — weekStarting comes back from
// the API as UTC midnight (see DutyRosterWeek.js), and this runs in
// whichever timezone the officer's own browser happens to be in. Mixing
// local Date methods (setHours/getDate) with toISOString() at the end
// would silently shift the result a calendar day backward for anyone
// ahead of UTC (e.g. UTC+5:30) once local midnight converts to the
// previous UTC day — the same class of bug already fixed server-side in
// reportsController.js's getForceStrength.
function computeMinWeekStarting(existingWeeks) {
  const now = new Date();
  // "Today" as the officer's own local calendar date, re-expressed as a
  // UTC-midnight instant so it can be compared/serialized alongside
  // weekStarting without a second timezone conversion undoing it.
  let min = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  for (const w of existingWeeks) {
    const dayAfter = new Date(w.weekStarting); // already UTC midnight
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    if (dayAfter > min) min = dayAfter;
  }
  return min.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The whole grid downstream (WeeklyGrid.jsx, RosterSummary.jsx) lays out
// exactly Sun-Sat from weekStarting — picking any other day of week would
// silently mislabel every day of the roster. Parsed as UTC (matching how
// weekStarting itself is stored/compared) so this agrees with the
// server's own check in dutyScheduleController.js's createWeek.
function isSunday(dateStr) {
  return new Date(dateStr).getUTCDay() === 0;
}

// computeMinWeekStarting above only blocks picking BEFORE the latest
// existing week — it doesn't stop picking a date that lands inside an
// earlier week's own 7-day span (e.g. after an older week was deleted
// and a new, non-adjacent one created). This checks every existing
// week's actual range, mirroring the server-side overlap check.
function overlappingWeek(dateStr, existingWeeks) {
  const start = new Date(dateStr);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return existingWeeks.find((w) => {
    const existingStart = new Date(w.weekStarting);
    const existingEnd = new Date(existingStart.getTime() + 6 * DAY_MS);
    return start <= existingEnd && existingStart <= end;
  });
}

const STEPS = [
  { n: 1, label: "Select Week" },
  { n: 2, label: "Branch Strength & Allocation" },
  { n: 3, label: "Review & Finish" },
];

export function CreateRosterWizard({ onCancel, onComplete, existingWeek, existingWeeks = [] }) {
  const { t } = useLanguage();

  const [step, setStep] = useState(existingWeek ? 2 : 1);
  const [weekId, setWeekId] = useState(existingWeek?.id || null);
  const [weekStarting, setWeekStarting] = useState("");
  const [creatingWeek, setCreatingWeek] = useState(false);
  const minWeekStarting = computeMinWeekStarting(existingWeeks);

  // Derived, not stateful — recomputed from weekStarting/existingWeeks
  // on every render, same as minWeekStarting above.
  let weekStartValidationError = "";
  if (weekStarting) {
    if (!isSunday(weekStarting)) {
      weekStartValidationError = t("dutyRoster.wizard.mustStartSunday");
    } else {
      const conflict = overlappingWeek(weekStarting, existingWeeks);
      if (conflict) {
        weekStartValidationError = t("dutyRoster.wizard.overlapsExistingWeek");
      }
    }
  }

  const [requirements, setRequirements] = useState(() => buildRequirements(existingWeek));
  const [savingRequirements, setSavingRequirements] = useState(false);
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const [allocatingKey, setAllocatingKey] = useState(null); // "branch::shiftType" currently running
  const [allocatedKeys, setAllocatedKeys] = useState(new Set());
  const [error, setError] = useState("");
  // Spec §7 — "why recommended/excluded", keyed the same way as
  // allocatedKeys ("branch::shiftType"); populated once that row's own
  // Smart Allocation (or Generate All) has actually run.
  const [candidateNotesByTarget, setCandidateNotesByTarget] = useState({});
  const [expandedNotesKey, setExpandedNotesKey] = useState(null);

  // Re-opening an existing draft: load what's already generated so the
  // staffing table and "Allocated" badges reflect reality immediately,
  // instead of looking blank until Save & Preview is clicked.
  useEffect(() => {
    if (!existingWeek) return;
    // Flips the loading flag before the fetch below resolves — a
    // legitimate "prop appeared, start loading" sync, not a smell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingOverview(true);
    getRosterWeek(existingWeek.id)
      .then((res) => {
        const keys = new Set();
        (res.shifts || []).forEach((s) => {
          if (s.status === "removed") return;
          keys.add(`${s.department}::${s.shiftType}`);
        });
        setAllocatedKeys(keys);
        return getStaffingOverview(existingWeek.id);
      })
      .then((overviewRes) => setOverview(overviewRes))
      .catch((err) => console.error("Could not load existing week for editing:", err))
      .finally(() => setLoadingOverview(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingWeek?.id]);

  // Clearing a number input to type a fresh value fires onChange with
  // "" first — Number("") is 0 (a real JS quirk, not NaN), so the old
  // `Math.max(0, Number(value) || 0)` immediately forced the field back
  // to a displayed "0" the instant it went empty, before the next digit
  // even landed. The field could never actually go empty, so typing
  // over the existing value looked like it was permanently stuck at 0.
  // Letting "" pass through as its own state (not coerced to 0) keeps
  // the field genuinely empty while typing; the server already
  // defaults a blank/non-numeric value to 0 on save either way (see
  // updateRequirements in dutyScheduleController.js), so nothing downstream needs to change.
  function updateRequirement(branch, field, value) {
    setRequirements((prev) =>
      prev.map((r) => {
        if (r.branch !== branch) return r;
        if (value === "") return { ...r, [field]: "" };
        return { ...r, [field]: Math.max(0, Number(value) || 0) };
      })
    );
  }

  async function handleStep1Next() {
    // Belt-and-suspenders alongside the date input's own `min` and the
    // Sunday/overlap checks below — those only gray out the calendar
    // widget or disable the button, they don't stop a date typed
    // directly into the field's segments (bypassing the popup entirely)
    // from reaching here.
    if (!weekStarting || weekStarting < minWeekStarting || weekStartValidationError) return;
    setCreatingWeek(true);
    setError("");
    try {
      const week = await createRosterWeek({ weekStarting });
      setWeekId(week.id);
      setStep(2);
    } catch (err) {
      console.error("Could not create roster week:", err);
      setError(err.message || t("dutyRoster.wizard.createWeekFailed"));
    } finally {
      setCreatingWeek(false);
    }
  }

  async function saveAndRefreshOverview() {
    if (!weekId) return;
    setSavingRequirements(true);
    setError("");
    try {
      await updateWeekRequirements(weekId, requirements);
      setLoadingOverview(true);
      const res = await getStaffingOverview(weekId);
      setOverview(res);
    } catch (err) {
      console.error("Could not save/preview requirements:", err);
      setError(t("dutyRoster.wizard.saveFailed"));
    } finally {
      setSavingRequirements(false);
      setLoadingOverview(false);
    }
  }

  async function runSmartAllocation(branch, shiftType) {
    const key = `${branch}::${shiftType}`;
    setAllocatingKey(key);
    setError("");
    try {
      const result = await generateRoster(weekId, { branch, shiftType });
      setAllocatedKeys((prev) => new Set(prev).add(key));
      if (result.candidateNotesByTarget) {
        setCandidateNotesByTarget((prev) => ({ ...prev, ...result.candidateNotesByTarget }));
      }
    } catch (err) {
      console.error("Smart Allocation failed:", err);
      setError(err?.message || t("dutyRoster.wizard.allocationFailed"));
    } finally {
      setAllocatingKey(null);
    }
  }

  async function handleGenerateAllRemaining() {
    setAllocatingKey("__all__");
    setError("");
    try {
      const result = await generateRoster(weekId); // no target = fills everything
      const allKeys = new Set(allocatedKeys);
      requirements.forEach((r) => {
        if (r.dayRequired > 0) allKeys.add(`${r.branch}::day`);
        if (r.nightRequired > 0) allKeys.add(`${r.branch}::night`);
      });
      setAllocatedKeys(allKeys);
      if (result.candidateNotesByTarget) {
        setCandidateNotesByTarget((prev) => ({ ...prev, ...result.candidateNotesByTarget }));
      }
      setStep(3);
    } catch (err) {
      console.error("Generate all failed:", err);
      setError(err?.message || t("dutyRoster.wizard.allocationFailed"));
    } finally {
      setAllocatingKey(null);
    }
  }

  const activeRequirements = requirements.filter((r) => r.dayRequired > 0 || r.nightRequired > 0);

  return (
    <Card variant="panel" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
                 <h2 style={{ margin: 0 }}>{existingWeek ? t("dutyRoster.wizard.editTitle") : t("dutyRoster.wizard.title")}</h2>
          <p style={{ color: "var(--color-text-muted)", margin: "4px 0 0" }}>
            {t("dutyRoster.wizard.step")} {step} {t("dutyRoster.wizard.of")} 3: {STEPS[step - 1].label}
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          {t("dutyRoster.cancel")}
        </Button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {STEPS.map((s) => (
          <div
            key={s.n}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: s.n <= step ? "var(--color-primary, #1d4ed8)" : "var(--color-border, #e5e7eb)",
            }}
          />
        ))}
      </div>

      {error && <div className="unfilled-warning" style={{ marginBottom: 16 }}>{error}</div>}

      {step === 1 && (
        <div style={{ maxWidth: 320 }}>
          <InputField
            label={t("dutyRoster.weekStarting")}
            type="date"
            required
            min={minWeekStarting}
            value={weekStarting}
            onChange={(e) => setWeekStarting(e.target.value)}
            helperText={t("dutyRoster.wizard.weekStartingHelper")}
          />
          {weekStartValidationError && (
            <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 13, marginTop: 4 }}>
              {weekStartValidationError}
            </p>
          )}
          <div className="roster-actions-row" style={{ marginTop: 16 }}>
            <Button
              variant="primary"
              onClick={handleStep1Next}
              disabled={!weekStarting || weekStarting < minWeekStarting || Boolean(weekStartValidationError) || creatingWeek}
            >
              {creatingWeek ? t("dutyRoster.wizard.creating") : t("dutyRoster.wizard.nextStep")}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3 style={{ marginTop: 0 }}>{t("dutyRoster.wizard.branchStrengthPlanning")}</h3>
          <div style={{ overflowX: "auto", marginBottom: 16 }}>
            <table className="roster-grid-table">
              <thead>
                <tr>
                  <th>{t("dutyRoster.departmentUnit")}</th>
                  <th>{t("dutyRoster.wizard.dayReq")}</th>
                  <th>{t("dutyRoster.wizard.nightReq")}</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.branch}>
                    <td>{shortBranchLabel(r.branch)}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        className="field-control"
                        style={{ width: 80 }}
                        value={r.dayRequired}
                        onChange={(e) => updateRequirement(r.branch, "dayRequired", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        className="field-control"
                        style={{ width: 80 }}
                        value={r.nightRequired}
                        onChange={(e) => updateRequirement(r.branch, "nightRequired", e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button variant="outline" onClick={saveAndRefreshOverview} disabled={savingRequirements}>
            {savingRequirements ? t("dutyRoster.wizard.saving") : t("dutyRoster.wizard.saveAndPreview")}
          </Button>

          {loadingOverview && <Loader label={t("dutyRoster.wizard.loadingOverview")} />}

          {overview && (
            <div style={{ marginTop: 24 }}>
              <h3>{t("dutyRoster.wizard.initialStaffing")}</h3>
              {overview.overview.map((row) => (
                <div key={row.branch} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {shortBranchLabel(row.branch)}
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                      {t("dutyRoster.wizard.req")} D:{row.day.required} / N:{row.night.required} ·{" "}
                      {t("dutyRoster.wizard.totalShortage")}{" "}
                      {row.day.shortage + row.night.shortage}
                    </span>
                  </div>
                  <table className="roster-grid-table">
                    <thead>
                      <tr>
                        <th>{t("dutyRoster.wizard.shift")}</th>
                        <th>{t("dutyRoster.requiredStaffing")}</th>
                        <th>{t("dutyRoster.wizard.permAvailable")}</th>
                        <th>{t("dutyRoster.wizard.shortage")}</th>
                        <th>{t("dutyRoster.wizard.action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["day", "night"].map((shiftType) => {
                        const shiftRow = row[shiftType];
                        if (shiftRow.required === 0) return null;
                        const key = `${row.branch}::${shiftType}`;
                        const isAllocating = allocatingKey === key;
                        const isDone = allocatedKeys.has(key);
                        const notes = candidateNotesByTarget[key];
                        const isExpanded = expandedNotesKey === key;
                        return (
                          <Fragment key={shiftType}>
                            <tr>
                              <td>{shiftType === "day" ? t("dutyRoster.wizard.dayShift") : t("dutyRoster.wizard.nightShift")}</td>
                              <td>{shiftRow.required}</td>
                              <td>{shiftRow.permAvailable}</td>
                              <td style={{ color: shiftRow.shortage > 0 ? "var(--color-danger, #dc2626)" : "inherit" }}>
                                {shiftRow.shortage}
                              </td>
                                                        <td>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  {isDone && <Badge status="approved" label={t("dutyRoster.wizard.allocated")} />}
                                  <Button
                                    variant="outline"
                                    onClick={() => runSmartAllocation(row.branch, shiftType)}
                                    disabled={isAllocating}
                                  >
                                    {isAllocating
                                      ? t("dutyRoster.wizard.allocating")
                                      : isDone
                                      ? t("dutyRoster.wizard.reallocate")
                                      : t("dutyRoster.wizard.smartAllocation")}
                                  </Button>
                                  {notes?.length > 0 && (
                                    <Button variant="ghost" onClick={() => setExpandedNotesKey(isExpanded ? null : key)}>
                                      {isExpanded ? t("dutyRoster.wizard.hideWhy") : t("dutyRoster.wizard.showWhy")}
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isExpanded && notes?.length > 0 && (
                              <tr>
                                <td colSpan={5} style={{ background: "var(--color-bg-subtle, #f9fafb)" }}>
                                  <ul style={{ listStyle: "none", margin: 0, padding: "8px 4px", display: "grid", gap: 4 }}>
                                    {notes.map((note) => (
                                      <li key={note.officerId} style={{ fontSize: 12, display: "flex", gap: 8 }}>
                                        <span style={{ fontWeight: 600, minWidth: 140 }}>
                                          {note.fullName} <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>{note.rankAndNumber}</span>
                                        </span>
                                        <span
                                          style={{
                                            color: note.daysSelected > 0 ? "var(--color-success, #16a34a)" : "var(--color-text-muted)",
                                          }}
                                        >
                                          {translateReasonNote(t, note)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          <div className="roster-actions-row" style={{ marginTop: 24 }}>
            <Button variant="ghost" onClick={() => setStep(1)}>
              {t("dutyRoster.wizard.back")}
            </Button>
            <Button
              variant="outline"
              onClick={handleGenerateAllRemaining}
              disabled={!overview || activeRequirements.length === 0 || allocatingKey === "__all__"}
            >
              {allocatingKey === "__all__" ? t("dutyRoster.wizard.allocating") : t("dutyRoster.wizard.generateAllRemaining")}
            </Button>
            <Button variant="primary" onClick={() => setStep(3)} disabled={allocatedKeys.size === 0}>
              {t("dutyRoster.wizard.nextStep")}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h3 style={{ marginTop: 0 }}>{t("dutyRoster.wizard.reviewTitle")}</h3>

          <ul style={{ listStyle: "none", padding: 0 }}>
            {activeRequirements.map((r) => (
              <li key={r.branch} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border, #e5e7eb)" }}>
                <strong>{shortBranchLabel(r.branch)}</strong>
                {" — "}
                {r.dayRequired > 0 && (
                  <Badge
                    status={allocatedKeys.has(`${r.branch}::day`) ? "approved" : "pending"}
                    label={`${t("dutyRoster.wizard.dayShift")}: ${allocatedKeys.has(`${r.branch}::day`) ? t("dutyRoster.wizard.allocated") : t("dutyRoster.wizard.notAllocated")}`}
                  />
                )}{" "}
                {r.nightRequired > 0 && (
                  <Badge
                    status={allocatedKeys.has(`${r.branch}::night`) ? "approved" : "pending"}
                    label={`${t("dutyRoster.wizard.nightShift")}: ${allocatedKeys.has(`${r.branch}::night`) ? t("dutyRoster.wizard.allocated") : t("dutyRoster.wizard.notAllocated")}`}
                  />
                )}
              </li>
            ))}
          </ul>

          <div className="roster-actions-row" style={{ marginTop: 24 }}>
            <Button variant="ghost" onClick={() => setStep(2)}>
              {t("dutyRoster.wizard.back")}
            </Button>
            <Button variant="primary" onClick={() => onComplete(weekId)}>
              {t("dutyRoster.wizard.finish")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}