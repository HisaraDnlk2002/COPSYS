import { useEffect, useState } from "react";
import { Button, Card, Badge, Loader, Modal, InputField } from "../../components";
import {
  getTodaysDuty,
  updateDutyShift,
  createDailyChange,
  getReplacementSuggestions,
} from "../../services/dutyRoster";
import { useLanguage } from "../../i18n/useLanguage";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function branchLabel(value) {
  return value ? value.split(" (")[0] : "";
}

function statusBadge(status) {
  if (status === "present") return "approved";
  if (status === "absent") return "rejected";
  return "pending";
}

export function DailyDutyUpdate() {
  const { t } = useLanguage();

  const [date, setDate] = useState(todayIso());
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [absentModalShift, setAbsentModalShift] = useState(null);
  const [reason, setReason] = useState("");
  const [notifyOfficer, setNotifyOfficer] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setError("");
    getTodaysDuty(date)
      .then((res) => setShifts(res))
      .catch((err) => {
        console.error("Could not load today's duty:", err);
        setError(t("dutyRoster.daily.loadFailed"));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function handleMarkPresent(shift) {
    try {
      await updateDutyShift(shift.id, { status: "present" });
      load();
    } catch (err) {
      console.error("Could not mark present:", err);
    }
  }

  function openAbsentModal(shift) {
    setAbsentModalShift(shift);
    setReason("");
    setNotifyOfficer(true);
    setSuggestions([]);
    setLoadingSuggestions(true);

    // Populated officerId sub-documents don't get the custom toJSON()
    // that adds `.id` — only top-level User docs do. Fall back to _id.
    const officerId = typeof shift.officerId === "object" ? (shift.officerId.id || shift.officerId._id) : shift.officerId;
    getReplacementSuggestions(officerId, shift.date)
      .then((res) => setSuggestions(res))
      .catch((err) => console.error("Could not load replacement suggestions:", err))
      .finally(() => setLoadingSuggestions(false));
  }

  async function confirmAbsence(replacementOfficerId) {
    if (!absentModalShift || !reason.trim()) return;
    setSubmitting(true);
    try {
      await createDailyChange({
        scheduleEntryId: absentModalShift.id,
        reason: reason.trim(),
        replacementOfficerId: replacementOfficerId || undefined,
        notifyOfficer,
      });
      setAbsentModalShift(null);
      load();
    } catch (err) {
      console.error("Could not record absence:", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && shifts.length === 0) return <Loader label={t("dutyRoster.daily.loading")} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{t("dutyRoster.daily.title")}</h2>
        <input
          type="date"
          className="field-control"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {error && <div className="unfilled-warning" style={{ marginBottom: 16 }}>{error}</div>}

      <Card variant="panel">
        {shifts.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>{t("dutyRoster.daily.noneScheduled")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="roster-grid-table">
              <thead>
                <tr>
                  <th>{t("dutyRoster.daily.officerName")}</th>
                  <th>{t("dutyRoster.daily.rank")}</th>
                  <th>{t("dutyRoster.departmentUnit")}</th>
                  <th>{t("dutyRoster.wizard.shift")}</th>
                  <th>{t("dutyRoster.status")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => {
                  const officer = typeof shift.officerId === "object" ? shift.officerId : null;
                  return (
                    <tr key={shift.id}>
                      <td>{officer?.fullName || t("common.unassigned")}</td>
                      <td>{officer?.rankAndNumber?.split(" ")[0] || "—"}</td>
                      <td>
                        {branchLabel(shift.department)}
                        {shift.assignmentType === "GENERAL_POOL" && (
                          <Badge status="general_pool" label={t("dutyRoster.generalPool")} />
                        )}
                      </td>
                      <td>
                        {shift.shiftType === "night" ? t("dutyRoster.wizard.nightShift") : t("dutyRoster.wizard.dayShift")}
                      </td>
                      <td>
                        <Badge status={statusBadge(shift.status)} label={t(`dutyRoster.daily.status.${shift.status}`)} />
                      </td>
                      <td>
                        {shift.status === "absent" ? (
                          <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                            {t("dutyRoster.daily.alreadyMarkedAbsent")}
                          </span>
                        ) : (
                          <div style={{ display: "flex", gap: 8 }}>
                            <Button variant="outline" onClick={() => handleMarkPresent(shift)}>
                              {t("dutyRoster.daily.markPresent")}
                            </Button>
                            <Button variant="ghost" onClick={() => openAbsentModal(shift)}>
                              {t("dutyRoster.daily.markAbsent")}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(absentModalShift)}
        onClose={() => setAbsentModalShift(null)}
        title={t("dutyRoster.daily.markAbsentTitle")}
        footer={
          <Button variant="primary" onClick={() => confirmAbsence(null)} disabled={!reason.trim() || submitting}>
            {submitting ? t("dutyRoster.daily.saving") : t("dutyRoster.daily.markAbsentNoReplacement")}
          </Button>
        }
      >
        <InputField
          label={t("dutyRoster.reason")}
          type="textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("dutyRoster.daily.reasonPlaceholder")}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
          <input type="checkbox" checked={notifyOfficer} onChange={(e) => setNotifyOfficer(e.target.checked)} />
          {t("dutyRoster.daily.notifyOfficer")}
        </label>

        <h4 style={{ marginBottom: 8 }}>{t("dutyRoster.daily.suggestedReplacements")}</h4>

        {loadingSuggestions ? (
          <Loader label={t("dutyRoster.findingReplacements")} />
        ) : suggestions.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{t("dutyRoster.noReplacementCandidates")}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {suggestions.map((s) => (
              <li
                key={s.officer.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--color-border, #e5e7eb)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{s.officer.fullName}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{s.reasonLabel}</div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => confirmAbsence(s.officer.id)}
                  disabled={!reason.trim() || submitting}
                >
                  {t("dutyRoster.assign")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}