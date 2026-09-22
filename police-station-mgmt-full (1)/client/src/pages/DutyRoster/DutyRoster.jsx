import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, Badge, Loader, Modal } from "../../components";
import {
  getRosterWeeks,
  getRosterWeek,
  deleteRosterWeek,
  generateRoster,
  submitRosterWeek,
  approveRosterWeek,
  sendBackRosterWeek,
  publishRosterWeek,
  unpublishRosterWeek,
} from "../../services/dutyRoster";
import { listUsers } from "../../services/users";
import { getAllLeaveRequests } from "../../services/leave";
import { formatDate } from "../../utils/formatDate";
import { CreateRosterWizard } from "./CreateRosterWizard";
import { DailyDutyUpdate } from "./DailyDutyUpdate";
import { WeeklyGrid } from "./WeeklyGrid";
import { RosterSummary } from "./RosterSummary";
import "./DutyRoster.css";

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
  const location = useLocation();
  const isDutyOfficer = user?.role === "duty_officer";
  const isOic = user?.role === "oic";

  const [activeTab, setActiveTab] = useState(location.state?.tab === "daily" ? "daily" : "weekly");
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  const [weekDetail, setWeekDetail] = useState(null); // { week, shifts }
  const [officers, setOfficers] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);

  const [showWizard, setShowWizard] = useState(Boolean(location.state?.openWizard));
  const [editingWeek, setEditingWeek] = useState(null); // week object when re-opening the wizard for an existing draft
  const [generating, setGenerating] = useState(false);
  const [unfilledDays, setUnfilledDays] = useState([]);

  const [sendBackReason, setSendBackReason] = useState("");
  const [showSendBackModal, setShowSendBackModal] = useState(false);
  const [unpublishReason, setUnpublishReason] = useState("");
  const [showUnpublishModal, setShowUnpublishModal] = useState(false);
  const [showFullRosterSummary, setShowFullRosterSummary] = useState(false);

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

  async function handleDeleteWeek(weekId, status, e) {
    e.stopPropagation(); // don't also trigger selecting the row
    const confirmMessage = status === "unpublished" ? t("dutyRoster.confirmDeleteUnpublished") : t("dutyRoster.confirmDeleteDraft");
    if (!window.confirm(confirmMessage)) return;
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

  // Spec §17 — never fires from the confirmation prompt itself; the
  // modal's own Cancel/close is the only other way out, same pattern as
  // handleSendBack/handleDeleteWeek.
  async function handleUnpublish() {
    if (!selectedWeekId) return;
    try {
      const updated = await unpublishRosterWeek(selectedWeekId, unpublishReason);
      setWeeks((prev) => prev.map((w) => (w.id === selectedWeekId ? { ...w, ...updated } : w)));
    } catch (err) {
      console.error("Could not unpublish week:", err);
    } finally {
      setShowUnpublishModal(false);
      setUnpublishReason("");
    }
  }

  // Print-isolation CSS (DutyRoster.css, @media print, scoped to this
  // one class on <body> — never a blanket rule, so it can't leak into
  // printing from any other page) hides everything except
  // .roster-summary-print-target while this class is present. Toggled
  // right around window.print() rather than left on, so a stray Ctrl+P
  // on this page at any other time still prints normally.
  function handlePrintRosterSummary() {
    document.body.classList.add("printing-roster-summary");
    function cleanup() {
      document.body.classList.remove("printing-roster-summary");
      window.removeEventListener("afterprint", cleanup);
    }
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  // Manual grid editing: only while the Duty Officer can still change
  // things (draft, sent back for revision, or pulled back from
  // published).
  const isEditableStatus = ["draft", "sent_back", "unpublished"].includes(weekDetail?.week?.status);

  if (loading) return <Loader label={t("dutyRoster.loading")} />;

  const selectedWeek = weeks.find((w) => w.id === selectedWeekId);
  const detailLoading = Boolean(selectedWeekId) && weekDetail?.week?.id !== selectedWeekId;

  // Only removed/cancelled cells are hidden — everything else counts.
  const activeShifts = (weekDetail?.shifts || []).filter((s) => s.status !== "removed");

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
          <Button
            variant="primary"
            onClick={() => {
              setEditingWeek(null);
              setShowWizard((v) => !v);
            }}
          >
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
          existingWeek={editingWeek}
          existingWeeks={weeks}
          onCancel={() => {
            setShowWizard(false);
            setEditingWeek(null);
          }}
          onComplete={(newWeekId) => {
            setShowWizard(false);
            setEditingWeek(null);
            getRosterWeeks()
              .then((res) => {
                setWeeks(res);
                setSelectedWeekId(newWeekId);
              })
              .catch((err) => console.error("Could not refresh weeks after wizard:", err));
            refreshSelectedWeek();
          }}
        />
      )}

      {!showWizard && (weeks.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>{t("dutyRoster.noRosterWeeks")}</p>
      ) : (
        <div className="roster-weeks-list">
          {/* Horizontal tabs, not a stacked list — a vertical row per
              week cost real space at the top of the page before ever
              reaching the roster grid itself. Only the 4 most recent
              weeks are shown here — `weeks` itself stays the full set
              (already sorted newest-first by the server) since other
              logic still needs every week, not just the visible ones:
              CreateRosterWizard's own min-date guard (existingWeeks
              prop) has to see every existing week to stop a new one
              from clashing with an older one that's since scrolled out
              of this strip, and selecting an older week from elsewhere
              still finds it via weeks.find() below either way. */}
          {weeks.slice(0, 4).map((week) => (
            <div
              key={week.id}
              className={`roster-week-tab${week.id === selectedWeekId ? " active" : ""}`}
              onClick={() => setSelectedWeekId(week.id)}
            >
              <span>{formatDate(week.weekStarting)}</span>
              <Badge status={week.status === "sent_back" ? "rejected" : week.status === "submitted" ? "pending" : week.status} />
              {isDutyOfficer && ["draft", "unpublished"].includes(week.status) && (
                <button
                  type="button"
                  className="roster-week-tab-delete"
                  title={t("dutyRoster.delete")}
                  onClick={(e) => handleDeleteWeek(week.id, week.status, e)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {weeks.length > 4 && (
            <span style={{ color: "var(--color-text-muted)", fontSize: 12, padding: "0 8px" }}>
              {weeks.length - 4} {t("dutyRoster.olderWeeksNotShown")}
            </span>
          )}
        </div>
      ))}

      {!showWizard && selectedWeek && (
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

            {selectedWeek.status === "unpublished" && selectedWeek.unpublishReason && (
              <div className="unfilled-warning">
                {t("dutyRoster.unpublishedReasonPrefix")} {selectedWeek.unpublishReason}
              </div>
            )}

            {isDutyOfficer && isEditableStatus && (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 12 }}>
                {t("dutyRoster.editHint")}
              </p>
            )}
            {detailLoading ? (
              <Loader label={t("dutyRoster.loadingWeekGrid")} />
            ) : (
              <WeeklyGrid
                week={selectedWeek}
                shifts={activeShifts}
                officers={officers}
                leaveRequests={leaveRequests}
                editable={isDutyOfficer && isEditableStatus}
                onChanged={refreshSelectedWeek}
              />
            )}

            <div className="roster-footer-stats">
                            <div className="roster-footer-stat">
                <div className="value">{activeShifts.length ? new Set(activeShifts.map((s) => (typeof s.officerId === "object" ? (s.officerId.id || s.officerId._id) : s.officerId))).size : 0}</div>
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
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingWeek(selectedWeek);
                    setShowWizard(true);
                  }}
                >
                  {t("dutyRoster.editRequirements")}
                </Button>
                <Button variant="outline" onClick={handleGenerate} disabled={generating}>
                  {generating ? t("dutyRoster.generating") : t("dutyRoster.generateRoster")}
                </Button>
                <Button variant="primary" onClick={handleSubmitWeek}>
                  {t("dutyRoster.submitToOic")}
                </Button>
              </div>
            )}

            {isDutyOfficer && ["sent_back", "unpublished"].includes(selectedWeek.status) && (
              <div className="roster-actions-row">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingWeek(selectedWeek);
                    setShowWizard(true);
                  }}
                >
                  {t("dutyRoster.editRequirements")}
                </Button>
                {/* Server allows regenerating a sent-back OR unpublished
                    week too (same composition-editing lock as manual
                    edits) — this used to be draft-only, which meant
                    Smart Allocation became permanently unusable the
                    moment a week left draft even once. */}
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

            {isDutyOfficer && selectedWeek.status === "approved" && (
              <div className="roster-actions-row">
                <Button variant="primary" onClick={handlePublishWeek}>
                  {t("dutyRoster.publish")}
                </Button>
              </div>
            )}

            {isDutyOfficer && selectedWeek.status === "published" && (
              <div className="roster-actions-row">
                <Button variant="ghost" onClick={() => setShowUnpublishModal(true)}>
                  {t("dutyRoster.unpublish")}
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

      {!showWizard && selectedWeek && selectedWeek.status === "published" && (
        <Card variant="panel" style={{ marginTop: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>{t("dutyRoster.summary.title")}</h3>
              <p style={{ color: "var(--color-text-muted)", fontSize: 13, margin: 0 }}>
                {t("dutyRoster.summary.subtitle")}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Button variant="outline" onClick={() => setShowFullRosterSummary(true)}>
                {t("dutyRoster.summary.fullView")}
              </Button>
              <Button variant="outline" onClick={handlePrintRosterSummary}>
                {t("dutyRoster.summary.print")}
              </Button>
            </div>
          </div>
          {/* Printing always reads from here (normal document flow),
              never from the Full View modal below — a position:fixed
              overlay doesn't play well with the print-isolation CSS
              trick (see handlePrintRosterSummary/DutyRoster.css). Both
              show the exact same data either way, so there's nothing
              for the Full View copy to miss.

              maxHeight is deliberate, not a layout accident — full
              width (every day column stays readable), but only a
              handful of officer rows before this scrolls internally,
              so the page itself doesn't need much scrolling to get
              past a 25-officer table. "Full View" removes the cap
              instead of just changing the width, matching what
              actually scrolls a full station roster: how many people,
              not how many days. */}
          <div className="roster-summary-print-target" style={{ marginTop: 16, maxHeight: 420, overflowY: "auto" }}>
            {detailLoading ? (
              <Loader label={t("dutyRoster.loadingWeekGrid")} />
            ) : (
              <RosterSummary
                week={selectedWeek}
                shifts={activeShifts}
                officers={officers}
                leaveRequests={leaveRequests}
              />
            )}
          </div>
        </Card>
      )}

      {/* Spec-adjacent UX fix — the summary's own card squeezes a
          9-column table (officer, department, 7 days) into whatever
          width the page layout leaves it, forcing awkward horizontal
          scrolling to see the later days. "Full View" reopens the exact
          same table at near-viewport width instead, nothing new to
          keep in sync. */}
      <Modal
        open={showFullRosterSummary}
        onClose={() => setShowFullRosterSummary(false)}
        title={t("dutyRoster.summary.title")}
        size="wide"
      >
        {selectedWeek && (
          <RosterSummary
            week={selectedWeek}
            shifts={activeShifts}
            officers={officers}
            leaveRequests={leaveRequests}
          />
        )}
      </Modal>

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
          voiceInput
          sinhalaTyping
        />
      </Modal>

      {/* Spec §17 — unpublishing never fires straight from the button;
          it always confirms first and requires a reason, same shape as
          sendBackWeek above but a Duty Officer pulling back their own
          live roster, not an OIC review verdict. */}
      <Modal
        open={showUnpublishModal}
        onClose={() => setShowUnpublishModal(false)}
        title={t("dutyRoster.unpublishModalTitle")}
        footer={
          <Button variant="primary" onClick={handleUnpublish} disabled={!unpublishReason.trim()}>
            {t("dutyRoster.unpublishConfirm")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginTop: 0 }}>
          {t("dutyRoster.unpublishWarning")}
        </p>
        <InputField
          label={t("dutyRoster.reason")}
          required
          type="textarea"
          value={unpublishReason}
          onChange={(e) => setUnpublishReason(e.target.value)}
          placeholder={t("dutyRoster.unpublishReasonPlaceholder")}
          voiceInput
          sinhalaTyping
        />
      </Modal>
        </>
      )}
    </div>
  );
}