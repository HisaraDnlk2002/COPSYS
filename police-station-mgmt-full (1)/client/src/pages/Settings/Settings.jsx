import { useEffect, useState } from "react";
import { Button, Card, Loader } from "../../components";
import { getSettings, updateSettings } from "../../services/settings";
import "./Settings.css";

const RBAC_MODULES = [
  { key: "leaveApprovals", label: "Leave Approvals" },
  { key: "complaintRegistry", label: "Complaint Registry" },
  { key: "inventoryIssues", label: "Inventory Issues" },
  { key: "dutyRosterPublish", label: "Duty Roster Publish" },
  { key: "systemReports", label: "System Reports" },
];

const RANK_COLUMNS = [
  { key: "chiefInspector", label: "Chief Inspector (OIC)" },
  { key: "inspectorOIC", label: "Inspector (OIC)" },
  { key: "sergeant", label: "Sergeant" },
  { key: "constable", label: "Constable" },
];

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((res) => {
        if (!cancelled) setSettings(res);
      })
      .catch((err) => console.error("Failed to load settings:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleField(key) {
    setSettings((s) => ({ ...s, [key]: !s[key] }));
  }

  function toggleRbac(moduleKey, rankKey) {
    setSettings((s) => ({
      ...s,
      rbac: {
        ...s.rbac,
        [moduleKey]: {
          ...s.rbac[moduleKey],
          [rankKey]: !s.rbac[moduleKey][rankKey],
        },
      },
    }));
  }

  function handleThresholdChange(value) {
    setSettings((s) => ({ ...s, criticalComplaintThreshold: Number(value) }));
  }

  async function handleSave() {
    setSaving(true);
    setSavedMessage("");
    try {
      await updateSettings(settings);
      setSavedMessage("Changes saved.");
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    setLoading(true);
    try {
      const fresh = await getSettings();
      setSettings(fresh);
    } finally {
      setLoading(false);
    }
  }

  if (loading || !settings) return <Loader label="Loading settings…" />;

  return (
    <div>
      <div className="settings-header">
        <div>
          <h1>System Setting</h1>
          <p className="settings-subtitle">Configure station-wide parameters, security protocols, and notification logic</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={handleDiscard}>Discard changes</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {savedMessage && <p style={{ color: "var(--color-success)", marginBottom: 16 }}>{savedMessage}</p>}

      <Card variant="panel" style={{ marginBottom: 24 }}>
        <div className="settings-section-title">Communication Protocols</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          Manage how the system alerts officers regarding urgent complaints or roster changes.
        </p>

        <div className="toggle-row">
          <div>
            <div className="toggle-row-label">SMS Notification</div>
            <div className="toggle-row-desc">Send official messages directly to registered mobile devices</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.smsNotificationsEnabled} onChange={() => toggleField("smsNotificationsEnabled")} />
            <span className="switch-slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row-label">Email Dispatch</div>
            <div className="toggle-row-desc">Daily duty summaries and leave approvals logs via official email</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.emailDispatchEnabled} onChange={() => toggleField("emailDispatchEnabled")} />
            <span className="switch-slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row-label">Alert Sensitivity — Critical Complaint Threshold</div>
            <div className="toggle-row-desc">
              Only level {settings.criticalComplaintThreshold}+ (severe) and above initiate emergency SMS alerts to HQ
            </div>
          </div>
          <input
            className="threshold-slider"
            type="range"
            min="1"
            max="5"
            value={settings.criticalComplaintThreshold}
            onChange={(e) => handleThresholdChange(e.target.value)}
          />
        </div>
      </Card>

      <Card variant="panel">
        <div className="settings-section-title">Role-Based Access Control (RBAC)</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8 }}>
          Define system capabilities for different ranks within the station hierarchy.
        </p>

        <table className="rbac-table">
          <thead>
            <tr>
              <th>Module / Rank</th>
              {RANK_COLUMNS.map((rank) => (
                <th key={rank.key}>{rank.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RBAC_MODULES.map((module) => (
              <tr key={module.key}>
                <td>{module.label}</td>
                {RANK_COLUMNS.map((rank) => (
                  <td key={rank.key}>
                    <input
                      type="checkbox"
                      checked={settings.rbac[module.key][rank.key]}
                      onChange={() => toggleRbac(module.key, rank.key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <p className="settings-footer-note">
          Changes to permissions are logged in the National Audit Trail and require an annual review.
        </p>
      </Card>
    </div>
  );
}