import { useEffect, useState } from "react";
import { Button, Card, Loader } from "../../components";
import { useLanguage } from "../../i18n/useLanguage";
import { getSettings, updateSettings } from "../../services/settings";
import "./Settings.css";

export function SettingsPage() {
  const { t } = useLanguage();

  const RBAC_MODULES = [
    { key: "leaveApprovals", label: t("settings.moduleLeaveApprovals") },
    { key: "complaintRegistry", label: t("settings.moduleComplaintRegistry") },
    { key: "inventoryIssues", label: t("settings.moduleInventoryIssues") },
    { key: "dutyRosterPublish", label: t("settings.moduleDutyRosterPublish") },
    { key: "systemReports", label: t("settings.moduleSystemReports") },
  ];

  const RANK_COLUMNS = [
    { key: "chiefInspector", label: t("settings.rankChiefInspector") },
    { key: "inspectorOIC", label: t("settings.rankInspectorOIC") },
    { key: "sergeant", label: t("settings.rankSergeant") },
    { key: "constable", label: t("settings.rankConstable") },
  ];

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
      setSavedMessage(t("settings.changesSaved"));
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

  if (loading || !settings) return <Loader label={t("settings.loading")} />;

  return (
    <div>
      <div className="settings-header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p className="settings-subtitle">{t("settings.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={handleDiscard}>{t("settings.discardChanges")}</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? t("settings.saving") : t("settings.saveChanges")}
          </Button>
        </div>
      </div>

      {savedMessage && <p style={{ color: "var(--color-success)", marginBottom: 16 }}>{savedMessage}</p>}

      <Card variant="panel" style={{ marginBottom: 24 }}>
        <div className="settings-section-title">{t("settings.communicationProtocols")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          {t("settings.communicationProtocolsDesc")}
        </p>

        <div className="toggle-row">
          <div>
            <div className="toggle-row-label">{t("settings.smsNotification")}</div>
            <div className="toggle-row-desc">{t("settings.smsNotificationDesc")}</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.smsNotificationsEnabled} onChange={() => toggleField("smsNotificationsEnabled")} />
            <span className="switch-slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row-label">{t("settings.emailDispatch")}</div>
            <div className="toggle-row-desc">{t("settings.emailDispatchDesc")}</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.emailDispatchEnabled} onChange={() => toggleField("emailDispatchEnabled")} />
            <span className="switch-slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div>
            <div className="toggle-row-label">{t("settings.alertSensitivity")}</div>
            <div className="toggle-row-desc">
              {t("settings.alertSensitivityDesc1")} {settings.criticalComplaintThreshold}{t("settings.alertSensitivityDesc2")}
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
        <div className="settings-section-title">{t("settings.rbacTitle")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8 }}>
          {t("settings.rbacDesc")}
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="rbac-table">
            <thead>
              <tr>
                <th>{t("settings.moduleRank")}</th>
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
        </div>

        <p className="settings-footer-note">
          {t("settings.rbacFooterNote")}
        </p>
      </Card>
    </div>
  );
}