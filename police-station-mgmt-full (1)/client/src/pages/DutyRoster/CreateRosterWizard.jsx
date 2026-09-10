import { useEffect, useState } from "react";
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

const STEPS = [
  { n: 1, label: "Select Week" },
  { n: 2, label: "Branch Strength & Allocation" },
  { n: 3, label: "Review & Finish" },
];

export function CreateRosterWizard({ onCancel, onComplete, existingWeek }) {
  const { t } = useLanguage();

  const [step, setStep] = useState(existingWeek ? 2 : 1);
  const [weekId, setWeekId] = useState(existingWeek?.id || null);
  const [weekStarting, setWeekStarting] = useState("");
  const [creatingWeek, setCreatingWeek] = useState(false);

  const [requirements, setRequirements] = useState(() => buildRequirements(existingWeek));
  const [savingRequirements, setSavingRequirements] = useState(false);
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const [allocatingKey, setAllocatingKey] = useState(null); // "branch::shiftType" currently running
  const [allocatedKeys, setAllocatedKeys] = useState(new Set());
  const [warnings, setWarnings] = useState([]); // unfilledDays across all runs this session
  const [error, setError] = useState("");

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

  function updateRequirement(branch, field, value) {
    setRequirements((prev) =>
      prev.map((r) => (r.branch === branch ? { ...r, [field]: Math.max(0, Number(value) || 0) } : r))
    );
  }

  async function handleStep1Next() {
    if (!weekStarting) return;
    setCreatingWeek(true);
    setError("");
    try {
      const week = await createRosterWeek({ weekStarting });
      setWeekId(week.id);
      setStep(2);
    } catch (err) {
      console.error("Could not create roster week:", err);
      setError(t("dutyRoster.wizard.createWeekFailed"));
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
      if (result.unfilledDays?.length) {
        setWarnings((prev) => [
          ...prev,
          ...result.unfilledDays.map((d) => ({ branch, shiftType, ...d })),
        ]);
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
      if (result.unfilledDays?.length) {
        setWarnings((prev) => [...prev, ...result.unfilledDays.map((d) => ({ ...d }))]);
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
            value={weekStarting}
            onChange={(e) => setWeekStarting(e.target.value)}
          />
          <div className="roster-actions-row" style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={handleStep1Next} disabled={!weekStarting || creatingWeek}>
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
                        return (
                          <tr key={shiftType}>
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
                              </div>
                            </td>
                          </tr>
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

          {warnings.length > 0 && (
            <div className="unfilled-warning" style={{ marginBottom: 16 }}>
              {t("dutyRoster.couldNotFullyStaff")}{" "}
              {warnings
                .map((w) => `${shortBranchLabel(w.branch || "")} ${w.shiftType || ""} ${w.day} (${t("dutyRoster.short")} ${w.shortfall})`)
                .join(", ")}
              . {t("dutyRoster.reviewAdjust")}
            </div>
          )}

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