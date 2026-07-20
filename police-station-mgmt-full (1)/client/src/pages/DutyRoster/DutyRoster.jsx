import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, Badge, Loader, Modal } from "../../components";
import {
  getRosterWeeks,
  getRosterWeek,
  createRosterWeek,
  generateRoster,
  submitRosterWeek,
  approveRosterWeek,
  sendBackRosterWeek,
  getReplacementSuggestions,
  DAYS_OF_WEEK,
} from "../../services/dutyRoster";
import { dummyRosterOfficers } from "../../services/dummyData";
import "./DutyRoster.css";

const EMPTY_GEN_FORM = { weekStarting: "", department: "Traffic Control", requiredStaffing: "", specialEvents: "" };

function shortDay(day) {
  return day.slice(0, 3);
}

export function DutyRosterPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isDutyOfficer = user?.role === "duty_officer";
  const isOic = user?.role === "oic";

  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  const [weekDetail, setWeekDetail] = useState(null); // { week, shifts }

  const [showGenForm, setShowGenForm] = useState(false);
  const [genForm, setGenForm] = useState(EMPTY_GEN_FORM);
  const [generating, setGenerating] = useState(false);
  const [unfilledDays, setUnfilledDays] = useState([]);

  const [sendBackReason, setSendBackReason] = useState("");
  const [showSendBackModal, setShowSendBackModal] = useState(false);

  const [suggestModal, setSuggestModal] = useState(null); // { officerId, officerName, date } | null
  const [suggestions, setSuggestions] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRosterWeeks()
      .then((res) => {
        if (cancelled) return;
        setWeeks(res);
        if (res.length > 0) setSelectedWeekId(res[0].id);
      })
      .catch((err) => console.error("Failed to load roster weeks:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedWeekId) return;
    let cancelled = false;
    getRosterWeek(selectedWeekId)
      .then((res) => {
        if (!cancelled) setWeekDetail(res);
      })
      .catch((err) => console.error("Failed to load week detail:", err));
    return () => {
      cancelled = true;
    };
  }, [selectedWeekId]);

  async function handleCreateWeek(e) {
    e.preventDefault();
    try {
      const newWeek = await createRosterWeek({
        weekStarting: genForm.weekStarting,
        department: genForm.department,
        requiredStaffing: Number(genForm.requiredStaffing) || 0,
        specialEvents: genForm.specialEvents,
      });
      setWeeks((prev) => [newWeek, ...prev]);
      setSelectedWeekId(newWeek.id);
      setShowGenForm(false);
      setGenForm(EMPTY_GEN_FORM);
    } catch (err) {
      console.error("Could not create roster week:", err);
    }
  }

  async function handleGenerate() {
    if (!selectedWeekId) return;
    setGenerating(true);
    try {
      const result = await generateRoster(selectedWeekId);
      setUnfilledDays(result.unfilledDays || []);
      const refreshed = await getRosterWeek(selectedWeekId);
      setWeekDetail(refreshed);
    } catch (err) {
      console.error("Generate roster failed:", err);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmitWeek() {
    if (!selectedWeekId) return;
    const updated = await submitRosterWeek(selectedWeekId);
    setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
  }

  async function handleApproveWeek() {
    if (!selectedWeekId) return;
    const updated = await approveRosterWeek(selectedWeekId);
    setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
  }

  async function handleSendBack() {
    if (!selectedWeekId) return;
    const updated = await sendBackRosterWeek(selectedWeekId, sendBackReason);
    setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
    setShowSendBackModal(false);
    setSendBackReason("");
  }

  async function openSuggestions(officer, date) {
    setSuggestModal({ officerId: officer.id, officerName: officer.fullName, date });
    setSuggestLoading(true);
    try {
      const result = await getReplacementSuggestions(officer.id, date);
      setSuggestions(result);
    } catch (err) {
      console.error("Could not load suggestions:", err);
    } finally {
      setSuggestLoading(false);
    }
  }

  if (loading) return <Loader label={t("dutyRoster.loading")} />;

  const selectedWeek = weeks.find((w) => w.id === selectedWeekId);
  const detailLoading = Boolean(selectedWeekId) && weekDetail?.week?.id !== selectedWeekId;
  const shiftsByOfficerAndDay = {};
  (weekDetail?.shifts || []).forEach((s) => {
    const key = `${typeof s.officerId === "object" ? s.officerId.id : s.officerId}-${s.day}`;
    shiftsByOfficerAndDay[key] = s;
  });

  // Same "fall back to raw value" rule Badge.jsx uses for status words
  // that aren't (yet) in the dictionary.
  function statusLabel(status) {
    const key = `status.${(status || "").toLowerCase()}`;
    const translated = t(key);
    return translated === key ? status : translated;
  }

  return (
    <div>
      <div className="roster-header">
        <h1>{t("dutyRoster.title")} {isOic ? t("dutyRoster.management") : t("dutyRoster.dashboard")}</h1>
        {isDutyOfficer && (
          <Button variant="primary" onClick={() => setShowGenForm((v) => !v)}>
            {showGenForm ? t("dutyRoster.cancel") : t("dutyRoster.newRosterWeek")}
          </Button>
        )}
      </div>

      {showGenForm && (
        <Card variant="panel" className="roster-tool-grid" style={{ marginBottom: 24 }}>
          <form onSubmit={handleCreateWeek} className="roster-tool-grid" style={{ width: "100%" }}>
            <InputField label={t("dutyRoster.weekStarting")} type="date" required value={genForm.weekStarting}
              onChange={(e) => setGenForm((f) => ({ ...f, weekStarting: e.target.value }))} />
            <InputField label={t("dutyRoster.departmentUnit")} value={genForm.department}
              onChange={(e) => setGenForm((f) => ({ ...f, department: e.target.value }))} />
            <InputField label={t("dutyRoster.requiredStaffing")} value={genForm.requiredStaffing}
              onChange={(e) => setGenForm((f) => ({ ...f, requiredStaffing: e.target.value }))} placeholder={t("dutyRoster.staffingPlaceholder")} />
            <Button variant="primary" type="submit">{t("dutyRoster.createWeek")}</Button>
          </form>
        </Card>
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
              {t("dutyRoster.weekOf")} {week.weekStarting} — {week.department}
            </span>
            <Badge status={week.status === "sent_back" ? "rejected" : week.status === "submitted" ? "pending" : week.status} />
          </div>
        ))}
      </div>

      {selectedWeek && (
        <Card variant="panel">
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

          {detailLoading ? (
            <Loader label={t("dutyRoster.loadingWeekGrid")} />
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
                  {dummyRosterOfficers.map((officer) => (
                    <tr key={officer.id}>
                      <td>{officer.fullName}</td>
                      {DAYS_OF_WEEK.map((day) => {
                        const shift = shiftsByOfficerAndDay[`${officer.id}-${shortDay(day)}`];
                        const code = shift ? "p" : "empty";
                        return (
                          <td key={day}>
                            <span
                              className={`roster-cell ${code}`}
                              title={shift ? `${shift.shiftStart}-${shift.shiftEnd} ${shift.department}` : t("dutyRoster.off")}
                              onClick={() => shift && isDutyOfficer && openSuggestions(officer, shift.date)}
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
              <div className="value">{selectedWeek.scheduledUnits}/{dummyRosterOfficers.length}</div>
              <div className="label">{t("dutyRoster.scheduledUnits")}</div>
            </div>
            <div className="roster-footer-stat">
              <div className="value">{selectedWeek.offDuty}</div>
              <div className="label">{t("dutyRoster.offDuty")}</div>
            </div>
            <div className="roster-footer-stat">
              <div className="value">{selectedWeek.leaveCoverage}</div>
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
        </Card>
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

      <Modal
        open={Boolean(suggestModal)}
        onClose={() => setSuggestModal(null)}
        title={suggestModal ? `${t("dutyRoster.replace")} ${suggestModal.officerName}` : ""}
      >
        {suggestLoading ? (
          <Loader label={t("dutyRoster.findingReplacements")} />
        ) : (
          <div className="suggestion-list">
            {suggestions.map((s, i) => (
              <div key={s.officer.id} className="suggestion-item">
                <div>
                  <div className="officer-name">{i + 1}. {s.officer.fullName}</div>
                  <div className="reason">{s.reasonLabel}</div>
                </div>
                <Button variant="outline" onClick={() => setSuggestModal(null)}>
                  {t("dutyRoster.assign")}
                </Button>
              </div>
            ))}
            {suggestions.length === 0 && <p>{t("dutyRoster.noReplacementCandidates")}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
