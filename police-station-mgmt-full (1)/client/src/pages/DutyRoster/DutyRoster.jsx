import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
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

  if (loading) return <Loader label="Loading duty roster…" />;

  const selectedWeek = weeks.find((w) => w.id === selectedWeekId);
  const detailLoading = Boolean(selectedWeekId) && weekDetail?.week?.id !== selectedWeekId;
  const shiftsByOfficerAndDay = {};
  (weekDetail?.shifts || []).forEach((s) => {
    const key = `${typeof s.officerId === "object" ? s.officerId.id : s.officerId}-${s.day}`;
    shiftsByOfficerAndDay[key] = s;
  });

  return (
    <div>
      <div className="roster-header">
        <h1>Duty Roster {isOic ? "Management" : "Dashboard"}</h1>
        {isDutyOfficer && (
          <Button variant="primary" onClick={() => setShowGenForm((v) => !v)}>
            {showGenForm ? "Cancel" : "New Roster Week"}
          </Button>
        )}
      </div>

      {showGenForm && (
        <Card variant="panel" className="roster-tool-grid" style={{ marginBottom: 24 }}>
          <form onSubmit={handleCreateWeek} className="roster-tool-grid" style={{ width: "100%" }}>
            <InputField label="Week Starting" type="date" required value={genForm.weekStarting}
              onChange={(e) => setGenForm((f) => ({ ...f, weekStarting: e.target.value }))} />
            <InputField label="Department/Unit" value={genForm.department}
              onChange={(e) => setGenForm((f) => ({ ...f, department: e.target.value }))} />
            <InputField label="Required Staffing" value={genForm.requiredStaffing}
              onChange={(e) => setGenForm((f) => ({ ...f, requiredStaffing: e.target.value }))} placeholder="e.g. 5" />
            <Button variant="primary" type="submit">Create Week</Button>
          </form>
        </Card>
      )}

      <div className="roster-weeks-list">
        {weeks.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>No roster weeks yet.</p>}
        {weeks.map((week) => (
          <div
            key={week.id}
            className={`roster-week-row${week.id === selectedWeekId ? " active" : ""}`}
            onClick={() => setSelectedWeekId(week.id)}
          >
            <span>
              Week of {week.weekStarting} — {week.department}
            </span>
            <Badge status={week.status === "sent_back" ? "rejected" : week.status === "submitted" ? "pending" : week.status} />
          </div>
        ))}
      </div>

      {selectedWeek && (
        <Card variant="panel">
          {unfilledDays.length > 0 && (
            <div className="unfilled-warning">
              Could not fully staff: {unfilledDays.map((d) => `${d.day} (short ${d.shortfall})`).join(", ")}.
              Review and adjust manually before submitting.
            </div>
          )}

          {selectedWeek.status === "sent_back" && selectedWeek.sendBackReason && (
            <div className="unfilled-warning">
              Sent back by OIC: {selectedWeek.sendBackReason}
            </div>
          )}

          {detailLoading ? (
            <Loader label="Loading week grid…" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="roster-grid-table">
                <thead>
                  <tr>
                    <th>Officer</th>
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
                              title={shift ? `${shift.shiftStart}-${shift.shiftEnd} ${shift.department}` : "Off"}
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
              <div className="label">Scheduled Units</div>
            </div>
            <div className="roster-footer-stat">
              <div className="value">{selectedWeek.offDuty}</div>
              <div className="label">Off Duty</div>
            </div>
            <div className="roster-footer-stat">
              <div className="value">{selectedWeek.leaveCoverage}</div>
              <div className="label">Leave Coverage</div>
            </div>
            <div className="roster-footer-stat">
              <div className="value" style={{ textTransform: "capitalize" }}>{selectedWeek.status}</div>
              <div className="label">Status</div>
            </div>
          </div>

          {isDutyOfficer && selectedWeek.status === "draft" && (
            <div className="roster-actions-row">
              <Button variant="outline" onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating…" : "Generate Roster"}
              </Button>
              <Button variant="primary" onClick={handleSubmitWeek}>
                Submit to OIC
              </Button>
            </div>
          )}

          {isOic && selectedWeek.status === "submitted" && (
            <div className="roster-actions-row">
              <Button variant="ghost" onClick={() => setShowSendBackModal(true)}>
                Send Back to Revise
              </Button>
              <Button variant="primary" onClick={handleApproveWeek}>
                Approve
              </Button>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={showSendBackModal}
        onClose={() => setShowSendBackModal(false)}
        title="Send roster back to revise"
        footer={
          <Button variant="primary" onClick={handleSendBack}>
            Send Back
          </Button>
        }
      >
        <InputField
          label="Reason"
          type="textarea"
          value={sendBackReason}
          onChange={(e) => setSendBackReason(e.target.value)}
          placeholder="e.g. Missing Friday night coverage"
        />
      </Modal>

      <Modal
        open={Boolean(suggestModal)}
        onClose={() => setSuggestModal(null)}
        title={suggestModal ? `Replace ${suggestModal.officerName}` : ""}
      >
        {suggestLoading ? (
          <Loader label="Finding replacements…" />
        ) : (
          <div className="suggestion-list">
            {suggestions.map((s, i) => (
              <div key={s.officer.id} className="suggestion-item">
                <div>
                  <div className="officer-name">{i + 1}. {s.officer.fullName}</div>
                  <div className="reason">{s.reasonLabel}</div>
                </div>
                <Button variant="outline" onClick={() => setSuggestModal(null)}>
                  Assign
                </Button>
              </div>
            ))}
            {suggestions.length === 0 && <p>No replacement candidates found.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
