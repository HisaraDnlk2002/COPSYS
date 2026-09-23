import { useEffect, useState } from "react";
import { Button, Card, InputField, Loader, Modal, Badge } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import { getBranchList, createBranch, updateBranch, getShiftList, updateShift } from "../../services/branchesAndShifts";

const EMPTY_BRANCH_FORM = { name: "", isGeneralPool: false };

// Spec §23 — admin/oic management UI for the Branch/Shift catalog that
// used to be hardcoded (see server/src/config/branches.js|shifts.js's
// own comments for the in-memory-cache-over-a-real-collection design
// this sits in front of). Rendered inside Settings.jsx, gated the same
// canManageSystemSettings way as Communication Protocols/RBAC above it.
export function BranchShiftSettings() {
  const { t } = useLanguage();
  const [branches, setBranches] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editingBranch, setEditingBranch] = useState(null); // existing branch object, or {} for "new"
  const [branchForm, setBranchForm] = useState(EMPTY_BRANCH_FORM);
  const [savingBranch, setSavingBranch] = useState(false);

  const [editingShift, setEditingShift] = useState(null);
  const [shiftForm, setShiftForm] = useState({ label: "", startTime: "", endTime: "" });
  const [savingShift, setSavingShift] = useState(false);

  // Also called directly (not just from the mount effect below) after
  // every save/toggle — doesn't re-show the Loader on those refreshes,
  // same convention as DutyRoster.jsx's refreshSelectedWeek: `loading`
  // only ever starts true (its useState above) and is never set back to
  // true here, so a save just swaps the data in place once it resolves.
  function load() {
    Promise.all([getBranchList(), getShiftList()])
      .then(([branchRes, shiftRes]) => {
        setBranches(branchRes || []);
        setShifts(shiftRes || []);
      })
      .catch((err) => {
        console.error("Failed to load branches/shifts:", err);
        setError(t("settings.branchShift.loadFailed"));
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openEditBranch(branch) {
    setEditingBranch(branch || {});
    setBranchForm(branch ? { name: branch.name, isGeneralPool: branch.isGeneralPool } : EMPTY_BRANCH_FORM);
    setError("");
  }

  async function handleSaveBranch() {
    if (!branchForm.name.trim()) return;
    setSavingBranch(true);
    setError("");
    try {
      if (editingBranch?.id) {
        await updateBranch(editingBranch.id, branchForm);
      } else {
        await createBranch(branchForm);
      }
      setEditingBranch(null);
      load();
    } catch (err) {
      setError(err?.message || t("settings.branchShift.saveFailed"));
    } finally {
      setSavingBranch(false);
    }
  }

  async function handleToggleBranchStatus(branch) {
    try {
      await updateBranch(branch.id, { status: branch.status === "active" ? "inactive" : "active" });
      load();
    } catch (err) {
      console.error("Could not toggle branch status:", err);
    }
  }

  function openEditShift(shift) {
    setEditingShift(shift);
    setShiftForm({ label: shift.label, startTime: shift.startTime, endTime: shift.endTime });
    setError("");
  }

  async function handleSaveShift() {
    if (!editingShift) return;
    setSavingShift(true);
    setError("");
    try {
      await updateShift(editingShift.id, shiftForm);
      setEditingShift(null);
      load();
    } catch (err) {
      setError(err?.message || t("settings.branchShift.saveFailed"));
    } finally {
      setSavingShift(false);
    }
  }

  if (loading) return <Loader label={t("settings.branchShift.loading")} />;

  return (
    <>
      <Card variant="panel" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div className="settings-section-title" style={{ marginBottom: 0 }}>{t("settings.branchShift.branchesTitle")}</div>
          <Button variant="outline" onClick={() => openEditBranch(null)}>{t("settings.branchShift.addBranch")}</Button>
        </div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          {t("settings.branchShift.branchesDesc")}
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="rbac-table">
            <thead>
              <tr>
                <th>{t("settings.branchShift.colName")}</th>
                <th>{t("settings.branchShift.colGeneralPool")}</th>
                <th>{t("settings.branchShift.colStatus")}</th>
                <th>{t("settings.branchShift.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.isGeneralPool ? <Badge status="info" label={t("dutyRoster.generalPool")} /> : "—"}</td>
                  <td><Badge status={b.status} /></td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <Button variant="ghost" onClick={() => openEditBranch(b)}>{t("settings.branchShift.edit")}</Button>
                    <Button variant="ghost" onClick={() => handleToggleBranchStatus(b)}>
                      {b.status === "active" ? t("settings.branchShift.deactivate") : t("settings.branchShift.activate")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card variant="panel" style={{ marginBottom: 24 }}>
        <div className="settings-section-title">{t("settings.branchShift.shiftsTitle")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          {t("settings.branchShift.shiftsDesc")}
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="rbac-table">
            <thead>
              <tr>
                <th>{t("settings.branchShift.colShift")}</th>
                <th>{t("settings.branchShift.colStart")}</th>
                <th>{t("settings.branchShift.colEnd")}</th>
                <th>{t("settings.branchShift.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td>{s.startTime}</td>
                  <td>{s.endTime}</td>
                  <td>
                    <Button variant="ghost" onClick={() => openEditShift(s)}>{t("settings.branchShift.edit")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={Boolean(editingBranch)}
        onClose={() => setEditingBranch(null)}
        title={editingBranch?.id ? t("settings.branchShift.editBranchTitle") : t("settings.branchShift.addBranchTitle")}
        footer={
          <Button variant="primary" onClick={handleSaveBranch} disabled={savingBranch || !branchForm.name.trim()}>
            {savingBranch ? t("settings.saving") : t("settings.branchShift.save")}
          </Button>
        }
      >
        <InputField
          label={t("settings.branchShift.colName")}
          required
          value={branchForm.name}
          onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
          sinhalaTyping
        />
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <div>
            <div className="toggle-row-label">{t("settings.branchShift.colGeneralPool")}</div>
            <div className="toggle-row-desc">{t("settings.branchShift.generalPoolHelper")}</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={branchForm.isGeneralPool}
              onChange={(e) => setBranchForm((f) => ({ ...f, isGeneralPool: e.target.checked }))}
            />
            <span className="switch-slider" />
          </label>
        </div>
        {error && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{error}</p>}
      </Modal>

      <Modal
        open={Boolean(editingShift)}
        onClose={() => setEditingShift(null)}
        title={t("settings.branchShift.editShiftTitle")}
        footer={
          <Button variant="primary" onClick={handleSaveShift} disabled={savingShift}>
            {savingShift ? t("settings.saving") : t("settings.branchShift.save")}
          </Button>
        }
      >
        <InputField
          label={t("settings.branchShift.colShift")}
          value={shiftForm.label}
          onChange={(e) => setShiftForm((f) => ({ ...f, label: e.target.value }))}
        />
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <InputField
            label={t("settings.branchShift.colStart")}
            type="time"
            value={shiftForm.startTime}
            onChange={(e) => setShiftForm((f) => ({ ...f, startTime: e.target.value }))}
          />
          <InputField
            label={t("settings.branchShift.colEnd")}
            type="time"
            value={shiftForm.endTime}
            onChange={(e) => setShiftForm((f) => ({ ...f, endTime: e.target.value }))}
          />
        </div>
        {error && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{error}</p>}
      </Modal>
    </>
  );
}
