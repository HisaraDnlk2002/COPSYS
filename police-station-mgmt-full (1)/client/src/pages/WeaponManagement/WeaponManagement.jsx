import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { Card, StatCard, Table, Badge, Loader, Button, Modal, InputField } from "../../components";
import { getMyWeapons, confirmTransaction } from "../../services/inventory";
import { getMyAlerts, updateAlertStatus } from "../../services/alerts";
import { formatDateAndTime } from "../../utils/formatDate";
import "./WeaponManagement.css";

// Maps InventoryTransaction.type -> the translation key + badge tone used
// to display it on the custody history table, and the confirm-action
// copy used on the pending-confirmation panel/modal for that type.
const TRANSACTION_TYPE = {
  issue: { labelKey: "typeIssue", tone: "info", actionKey: "confirmReceipt", titleKey: "confirmReceiptTitle", textKey: "confirmReceiptText" },
  return: { labelKey: "typeReturn", tone: "success", actionKey: "confirmReturn", titleKey: "confirmReturnTitle", textKey: "confirmReturnText" },
  damaged: { labelKey: "typeDamaged", tone: "danger", actionKey: "confirmReturn", titleKey: "confirmReturnTitle", textKey: "confirmReturnText" },
};

const ALERT_PRIORITY_TONE = { critical: "danger", warning: "warning", info: "info" };
const ALERT_PRIORITY_LABEL_KEY = { critical: "priorityCritical", warning: "priorityWarning", info: "priorityInfo" };
const ALERT_STATUS_LABEL_KEY = { new: "alertStatusNew", acknowledged: "alertStatusAcknowledged", action_taken: "alertStatusActionTaken", resolved: "alertStatusResolved" };
// The one step forward from each status, and the action-button copy for
// making that step — same lifecycle as the Inventory Officer's Alerts
// tab (Inventory.jsx), just scoped here to the officer's own alerts.
const ALERT_NEXT_STATUS = { new: "acknowledged", acknowledged: "action_taken", action_taken: "resolved" };
const ALERT_ACTION_KEY = { acknowledged: "acknowledgeAlert", action_taken: "markActionTaken", resolved: "resolveAlert" };

// Officer-facing "My Weapons" view — the only firearm(s) currently
// assigned to the logged-in user, their own custody history, and any
// transaction (issue OR return/damaged) awaiting their own confirmation.
//
// The confirm action here is the ONLY place in the app that can move a
// transaction from "pending" to "secured" — see confirmTransaction in
// inventoryController.js, which enforces that server-side (the caller
// must BE the officer named on the transaction). The Inventory
// Officer's own pages have no equivalent control; they can only see the
// status, never set it. Confirming a return is also what actually
// applies the stock update (weapon -> available/damaged) — until the
// officer confirms, the weapon stays formally "in their custody" even
// if it's already physically back at the armory.
export function WeaponManagementPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [assigned, setAssigned] = useState([]);
  const [history, setHistory] = useState([]);
  const [pendingConfirmation, setPendingConfirmation] = useState([]);
  const [myAlerts, setMyAlerts] = useState([]);

  const [confirmingTx, setConfirmingTx] = useState(null); // the pending transaction being confirmed, or null
  const [confirmRemarks, setConfirmRemarks] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  // The alert currently open in the status-update modal, or null.
  const [actingAlert, setActingAlert] = useState(null);
  const [alertRemarks, setAlertRemarks] = useState("");
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const [alertError, setAlertError] = useState("");

  function loadData() {
    return Promise.all([getMyWeapons(), getMyAlerts()]).then(([weapons, alerts]) => {
      setAssigned(weapons.assigned || []);
      setHistory(weapons.history || []);
      setPendingConfirmation(weapons.pendingConfirmation || []);
      setMyAlerts(alerts || []);
    });
  }

  useEffect(() => {
    let cancelled = false;
    loadData()
      .catch((err) => console.error("Failed to load weapon custody:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openConfirm(tx) {
    setConfirmingTx(tx);
    setConfirmRemarks("");
    setConfirmError("");
  }

  function closeConfirm() {
    setConfirmingTx(null);
    setConfirmRemarks("");
    setConfirmError("");
  }

  async function handleConfirm() {
    setConfirming(true);
    setConfirmError("");
    try {
      await confirmTransaction(confirmingTx.id, confirmRemarks);
      await loadData();
      closeConfirm();
    } catch (err) {
      setConfirmError(err.message || t("weaponManagement.errConfirmFailed"));
    } finally {
      setConfirming(false);
    }
  }

  function openAlertAction(alert) {
    setActingAlert(alert);
    setAlertRemarks(alert.remarks || "");
    setAlertError("");
  }

  function closeAlertAction() {
    setActingAlert(null);
    setAlertRemarks("");
    setAlertError("");
  }

  async function handleAlertActionSubmit(nextStatus) {
    setAlertSubmitting(true);
    setAlertError("");
    try {
      await updateAlertStatus(actingAlert.id, nextStatus, alertRemarks);
      await loadData();
      closeAlertAction();
    } catch (err) {
      setAlertError(err.message || t("weaponManagement.errAlertUpdateFailed"));
    } finally {
      setAlertSubmitting(false);
    }
  }

  if (loading) return <Loader label={t("weaponManagement.loading")} />;

  const lastActivity = history[0]?.dateTime;
  const openAlertsCount = myAlerts.filter((a) => a.status !== "resolved").length;
  const confirmingMeta = confirmingTx ? TRANSACTION_TYPE[confirmingTx.type] || TRANSACTION_TYPE.issue : null;
  const isReturnLike = confirmingTx?.type === "return" || confirmingTx?.type === "damaged";

  const pendingColumns = [
    { key: "itemId", label: t("weaponManagement.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    {
      key: "type",
      label: t("weaponManagement.colTransactionType"),
      render: (row) => {
        const meta = TRANSACTION_TYPE[row.type] || TRANSACTION_TYPE.issue;
        return <Badge tone={meta.tone}>{t(`weaponManagement.${meta.labelKey}`)}</Badge>;
      },
    },
    { key: "quantity", label: t("weaponManagement.colQuantity") },
    { key: "dateTime", label: t("weaponManagement.colDateTime"), render: (row) => formatDateAndTime(row.dateTime) },
    { key: "processedBy", label: t("weaponManagement.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
    {
      key: "actions",
      label: "",
      render: (row) => {
        const meta = TRANSACTION_TYPE[row.type] || TRANSACTION_TYPE.issue;
        return (
          <Button variant="primary" onClick={() => openConfirm(row)}>
            {t(`weaponManagement.${meta.actionKey}`)}
          </Button>
        );
      },
    },
  ];

  const custodyColumns = [
    { key: "itemId", label: t("weaponManagement.colItemId") },
    { key: "itemName", label: t("weaponManagement.colItemName") },
    { key: "quantity", label: t("weaponManagement.colQuantity") },
    { key: "condition", label: t("weaponManagement.colCondition"), render: (row) => <Badge status={row.condition || "good"} /> },
  ];

  const historyColumns = [
    { key: "dateTime", label: t("weaponManagement.colDateTime"), render: (row) => formatDateAndTime(row.dateTime) },
    { key: "itemId", label: t("weaponManagement.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    {
      key: "type",
      label: t("weaponManagement.colTransactionType"),
      render: (row) => {
        const meta = TRANSACTION_TYPE[row.type] || TRANSACTION_TYPE.issue;
        return <Badge tone={meta.tone}>{t(`weaponManagement.${meta.labelKey}`)}</Badge>;
      },
    },
    { key: "quantity", label: t("weaponManagement.colQuantity") },
    { key: "condition", label: t("weaponManagement.colCondition"), render: (row) => (row.condition ? <Badge status={row.condition} /> : "—") },
    {
      key: "confirmationStatus",
      label: t("weaponManagement.colConfirmation"),
      render: (row) =>
        row.confirmationStatus === "secured" ? (
          <Badge tone="success">{t("weaponManagement.secured")}</Badge>
        ) : row.confirmationStatus === "pending" ? (
          <Badge tone="warning">{t("weaponManagement.pending")}</Badge>
        ) : (
          "—"
        ),
    },
    { key: "processedBy", label: t("weaponManagement.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
    { key: "remarks", label: t("weaponManagement.colRemarks"), render: (row) => row.remarks || "—" },
  ];

  const myAlertColumns = [
    {
      key: "priority",
      label: t("weaponManagement.colPriority"),
      render: (row) => <Badge tone={ALERT_PRIORITY_TONE[row.priority]}>{t(`weaponManagement.${ALERT_PRIORITY_LABEL_KEY[row.priority]}`)}</Badge>,
    },
    { key: "title", label: t("weaponManagement.colAlertTitle"), render: (row) => (<span title={row.message || undefined}>{row.title}</span>) },
    { key: "itemId", label: t("weaponManagement.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "generatedAt", label: t("weaponManagement.colDateTime"), render: (row) => formatDateAndTime(row.generatedAt) },
    {
      key: "status",
      label: t("weaponManagement.colAlertStatus"),
      render: (row) => <Badge status={row.status}>{t(`weaponManagement.${ALERT_STATUS_LABEL_KEY[row.status]}`)}</Badge>,
    },
    {
      key: "actions",
      label: "",
      render: (row) => {
        const next = ALERT_NEXT_STATUS[row.status];
        if (!next) return null;
        return (
          <Button variant="ghost" onClick={() => openAlertAction(row)}>
            {t(`weaponManagement.${ALERT_ACTION_KEY[next]}`)}
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <div className="weapon-mgmt-header">
        <h1>{t("weaponManagement.title")}</h1>
      </div>
      <p className="weapon-mgmt-subtitle">{t("weaponManagement.subtitle")}</p>

      <div className="stat-grid">
        <StatCard label={t("weaponManagement.inCustody")} value={assigned.length} />
        <StatCard label={t("weaponManagement.awaitingConfirmation")} value={pendingConfirmation.length} />
        <StatCard label={t("weaponManagement.openAlerts")} value={openAlertsCount} />
        <StatCard
          label={t("weaponManagement.lastActivity")}
          value={lastActivity ? formatDateAndTime(lastActivity) : t("weaponManagement.noActivityYet")}
        />
      </div>

      {pendingConfirmation.length > 0 && (
        <Card variant="panel" className="weapon-mgmt-section weapon-mgmt-pending">
          <h3 className="section-label">{t("weaponManagement.pendingConfirmationTitle")}</h3>
          <p className="weapon-mgmt-section-subtitle">{t("weaponManagement.pendingConfirmationSubtitle")}</p>
          <Table columns={pendingColumns} data={pendingConfirmation} emptyMessage="" />
        </Card>
      )}

      <Card variant="panel" className="weapon-mgmt-section">
        <h3 className="section-label">{t("weaponManagement.inCustody")}</h3>
        <Table columns={custodyColumns} data={assigned} emptyMessage={t("weaponManagement.noWeaponsAssigned")} />
      </Card>

      <Card variant="panel" className="weapon-mgmt-section">
        <h3 className="section-label">{t("weaponManagement.historyTitle")}</h3>
        <p className="weapon-mgmt-section-subtitle">{t("weaponManagement.historySubtitle")}</p>
        <Table columns={historyColumns} data={history} emptyMessage={t("weaponManagement.noHistoryYet")} />
      </Card>

      <Card variant="panel">
        <h3 className="section-label">{t("weaponManagement.myAlertsTitle")}</h3>
        <p className="weapon-mgmt-section-subtitle">{t("weaponManagement.myAlertsSubtitle")}</p>
        <Table columns={myAlertColumns} data={myAlerts} emptyMessage={t("weaponManagement.noAlerts")} />
      </Card>

      <Modal
        open={Boolean(confirmingTx)}
        onClose={closeConfirm}
        title={confirmingMeta ? t(`weaponManagement.${confirmingMeta.titleKey}`) : ""}
        footer={
          <Button variant="primary" fullWidth onClick={handleConfirm} disabled={confirming}>
            {confirming ? t("weaponManagement.confirming") : confirmingMeta ? t(`weaponManagement.${confirmingMeta.actionKey}`) : ""}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {confirmingMeta && t(`weaponManagement.${confirmingMeta.textKey}`)}
        </p>
        {confirmingTx && (
          <div className="weapon-mgmt-confirm-details">
            <p><strong>{t("weaponManagement.colItemId")}:</strong> {confirmingTx.itemId?.itemId || confirmingTx.itemId?.itemName || "—"}</p>
            <p><strong>{t("weaponManagement.colQuantity")}:</strong> {confirmingTx.quantity}</p>
            {isReturnLike && <p><strong>{t("weaponManagement.colCondition")}:</strong> {confirmingTx.condition || "—"}</p>}
            {isReturnLike && (confirmingTx.ammoIssued !== null || confirmingTx.ammoReturned !== null) && (
              <>
                <p><strong>{t("weaponManagement.ammoIssued")}:</strong> {confirmingTx.ammoIssued ?? "—"}</p>
                <p><strong>{t("weaponManagement.ammoReturned")}:</strong> {confirmingTx.ammoReturned ?? "—"}</p>
                <p><strong>{t("weaponManagement.ammoUsed")}:</strong> {confirmingTx.ammoUsed ?? "—"}</p>
              </>
            )}
            <p><strong>{t("weaponManagement.colProcessedBy")}:</strong> {confirmingTx.processedBy?.fullName || confirmingTx.processedBy?.rankAndNumber || "—"}</p>
            <p><strong>{t("weaponManagement.colDateTime")}:</strong> {formatDateAndTime(confirmingTx.dateTime)}</p>
          </div>
        )}
        <InputField
          label={t("weaponManagement.confirmRemarksLabel")}
          type="textarea"
          rows={3}
          value={confirmRemarks}
          onChange={(e) => setConfirmRemarks(e.target.value)}
          placeholder={t("weaponManagement.confirmRemarksPlaceholder")}
          voiceInput
          sinhalaTyping
        />
        {confirmError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{confirmError}</p>}
      </Modal>

      <Modal
        open={Boolean(actingAlert)}
        onClose={closeAlertAction}
        title={actingAlert ? actingAlert.title : ""}
        footer={
          actingAlert &&
          ALERT_NEXT_STATUS[actingAlert.status] && (
            <Button
              variant="primary"
              fullWidth
              onClick={() => handleAlertActionSubmit(ALERT_NEXT_STATUS[actingAlert.status])}
              disabled={alertSubmitting}
            >
              {alertSubmitting
                ? t("weaponManagement.confirming")
                : t(`weaponManagement.${ALERT_ACTION_KEY[ALERT_NEXT_STATUS[actingAlert.status]]}`)}
            </Button>
          )
        }
      >
        {actingAlert && (
          <div className="weapon-mgmt-confirm-details">
            {actingAlert.message && <p><strong>{t("weaponManagement.colMessage")}:</strong> {actingAlert.message}</p>}
            <p><strong>{t("weaponManagement.colItemId")}:</strong> {actingAlert.itemId?.itemId || actingAlert.itemId?.itemName || "—"}</p>
            <p><strong>{t("weaponManagement.colDateTime")}:</strong> {formatDateAndTime(actingAlert.generatedAt)}</p>
          </div>
        )}
        <InputField
          label={t("weaponManagement.confirmRemarksLabel")}
          type="textarea"
          rows={3}
          value={alertRemarks}
          onChange={(e) => setAlertRemarks(e.target.value)}
          voiceInput
          sinhalaTyping
        />
        {alertError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{alertError}</p>}
      </Modal>
    </div>
  );
}
