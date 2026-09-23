import { useEffect, useState } from "react";
import { Button, Card, InputField, Loader } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { getSettings, updateSettings } from "../../services/settings";
import { updateMyProfile, changeMyPassword } from "../../services/users";
import { BranchShiftSettings } from "./BranchShiftSettings";
import "./Settings.css";

const ACCOUNT_FIELDS = ["phoneNumber", "email", "address", "emergencyContactName", "emergencyContactPhone"];

export function SettingsPage() {
  const { t } = useLanguage();
  const { user, refreshProfile } = useAuth();
  // The Communication Protocols + RBAC sections are station-wide config,
  // not personal — same oic/admin boundary the backend enforces on
  // GET/PATCH /api/settings. "My Account" below, on the other hand, is
  // every role's own profile — the /settings route itself has no role
  // restriction any more (see App.jsx).
  const canManageSystemSettings = user?.role === "oic" || user?.role === "admin";

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

  const [loading, setLoading] = useState(canManageSystemSettings);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!canManageSystemSettings) return;
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
  }, [canManageSystemSettings]);

  // --- My Account (every role) ---------------------------------------
  const [account, setAccount] = useState({
    phoneNumber: "",
    email: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  });
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");

  useEffect(() => {
    if (!user) return;
    // Syncs the editable form from the auth context's user object — on
    // first load, and again after refreshProfile() following a save —
    // rather than reading `user` directly, so typing into these fields
    // doesn't require touching AuthContext at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccount({
      phoneNumber: user.phoneNumber || "",
      email: user.email || "",
      address: user.address || "",
      emergencyContactName: user.emergencyContactName || "",
      emergencyContactPhone: user.emergencyContactPhone || "",
    });
  }, [user]);

  function updateAccountField(key, value) {
    setAccount((a) => ({ ...a, [key]: value }));
  }

  async function handleSaveAccount() {
    setAccountSaving(true);
    setAccountMessage("");
    setAccountError("");
    try {
      const payload = {};
      ACCOUNT_FIELDS.forEach((key) => {
        payload[key] = account[key];
      });
      await updateMyProfile(payload);
      await refreshProfile();
      setAccountMessage(t("settings.accountSaved"));
    } catch (err) {
      console.error("Failed to save account details:", err);
      setAccountError(err.message || t("settings.accountSaveFailed"));
    } finally {
      setAccountSaving(false);
    }
  }

  // --- Change Password (every role) -----------------------------------
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  function updatePasswordField(key, value) {
    setPasswordForm((p) => ({ ...p, [key]: value }));
  }

  async function handleChangePassword() {
    setPasswordError("");
    setPasswordMessage("");

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError(t("settings.passwordsDontMatch"));
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordError(t("settings.passwordTooShort"));
      return;
    }

    setPasswordSaving(true);
    try {
      await changeMyPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordMessage(t("settings.passwordChanged"));
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      console.error("Failed to change password:", err);
      setPasswordError(err.message || t("settings.passwordChangeFailed"));
    } finally {
      setPasswordSaving(false);
    }
  }

  // --- System Settings (oic/admin only) --------------------------------
  function toggleField(key) {
    setSettings((s) => ({ ...s, [key]: !s[key] }));
  }

  function toggleRbac(moduleKey, rankKey) {
    setSettings((s) => ({
      ...s,
      rbac: {
        ...s.rbac,
        // A settings doc missing this module entirely (predates it being
        // added, or an incompletely-seeded default — see
        // settingsController.js) used to crash this whole page outright;
        // treat a missing module the same as "everyone unchecked" instead.
        [moduleKey]: {
          ...(s.rbac[moduleKey] || {}),
          [rankKey]: !s.rbac[moduleKey]?.[rankKey],
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

  if (canManageSystemSettings && (loading || !settings)) return <Loader label={t("settings.loading")} />;

  return (
    <div>
      <div className="settings-header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p className="settings-subtitle">{t("settings.subtitle")}</p>
        </div>
        {canManageSystemSettings && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={handleDiscard}>{t("settings.discardChanges")}</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? t("settings.saving") : t("settings.saveChanges")}
            </Button>
          </div>
        )}
      </div>

      {savedMessage && <p style={{ color: "var(--color-success)", marginBottom: 16 }}>{savedMessage}</p>}

      <Card variant="panel" style={{ marginBottom: 24 }}>
        <div className="settings-section-title">{t("settings.myAccount")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          {t("settings.myAccountDesc")}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
          <InputField label={t("settings.fullNameLabel")} value={user?.fullName || ""} readOnly />
          <InputField label={t("settings.rankNumberLabel")} value={user?.rankAndNumber || ""} readOnly />
          <InputField label={t("settings.roleLabel")} value={user?.role || ""} readOnly />
          <InputField label={t("settings.departmentLabel")} value={user?.department || ""} readOnly />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <InputField
            label={t("settings.phoneNumberLabel")}
            value={account.phoneNumber}
            onChange={(e) => updateAccountField("phoneNumber", e.target.value)}
          />
          <InputField
            label={t("settings.emailLabel")}
            type="email"
            value={account.email}
            onChange={(e) => updateAccountField("email", e.target.value)}
          />
          <InputField
            label={t("settings.addressLabel")}
            value={account.address}
            onChange={(e) => updateAccountField("address", e.target.value)}
            sinhalaTyping
          />
          <InputField
            label={t("settings.emergencyContactNameLabel")}
            value={account.emergencyContactName}
            onChange={(e) => updateAccountField("emergencyContactName", e.target.value)}
            sinhalaTyping
          />
          <InputField
            label={t("settings.emergencyContactPhoneLabel")}
            value={account.emergencyContactPhone}
            onChange={(e) => updateAccountField("emergencyContactPhone", e.target.value)}
          />
        </div>

        {accountMessage && <p style={{ color: "var(--color-success)", marginTop: 12 }}>{accountMessage}</p>}
        {accountError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{accountError}</p>}

        <div style={{ marginTop: 16 }}>
          <Button variant="primary" onClick={handleSaveAccount} disabled={accountSaving}>
            {accountSaving ? t("settings.saving") : t("settings.saveAccountDetails")}
          </Button>
        </div>
      </Card>

      <Card variant="panel" style={{ marginBottom: 24 }}>
        <div className="settings-section-title">{t("settings.changePasswordTitle")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          {t("settings.changePasswordDesc")}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <InputField
            label={t("settings.currentPasswordLabel")}
            type="password"
            value={passwordForm.currentPassword}
            onChange={(e) => updatePasswordField("currentPassword", e.target.value)}
          />
          <InputField
            label={t("settings.newPasswordLabel")}
            type="password"
            value={passwordForm.newPassword}
            onChange={(e) => updatePasswordField("newPassword", e.target.value)}
          />
          <InputField
            label={t("settings.confirmNewPasswordLabel")}
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(e) => updatePasswordField("confirmPassword", e.target.value)}
          />
        </div>

        {passwordMessage && <p style={{ color: "var(--color-success)", marginTop: 12 }}>{passwordMessage}</p>}
        {passwordError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{passwordError}</p>}

        <div style={{ marginTop: 16 }}>
          <Button
            variant="primary"
            onClick={handleChangePassword}
            disabled={passwordSaving || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
          >
            {passwordSaving ? t("settings.saving") : t("settings.changePasswordButton")}
          </Button>
        </div>
      </Card>

      {canManageSystemSettings && settings && (
        <>
          <BranchShiftSettings />

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
                            checked={Boolean(settings.rbac[module.key]?.[rank.key])}
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
        </>
      )}
    </div>
  );
}
