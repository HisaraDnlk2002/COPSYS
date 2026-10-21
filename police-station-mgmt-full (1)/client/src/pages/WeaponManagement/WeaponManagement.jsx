import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { Card, StatCard, Table, Badge, Loader, Button, Modal, InputField } from "../../components";
import { getMyWeapons, confirmTransaction, rejectTransaction, submitMyReturn } from "../../services/inventory";
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

// Item ID alone ("10016") doesn't say what the item actually is —
// show the weapon name alongside it wherever an officer has to
// recognize which weapon a transaction/alert is about.
function itemLabel(item) {
  if (!item) return "—";
  if (item.itemId && item.itemName) return `${item.itemId} — ${item.itemName}`;
  return item.itemId || item.itemName || "—";
}

const ALERT_PRIORITY_TONE = { critical: "danger", warning: "warning", info: "info" };
const ALERT_PRIORITY_LABEL_KEY = { critical: "priorityCritical", warning: "priorityWarning", info: "priorityInfo" };
const ALERT_STATUS_LABEL_KEY = { new: "alertStatusNew", acknowledged: "alertStatusAcknowledged", action_taken: "alertStatusActionTaken", resolved: "alertStatusResolved" };
// The one step forward from each status, and the action-button copy for
// making that step — same lifecycle as the Inventory Officer's Alerts
// tab (Inventory.jsx), just scoped here to the officer's own alerts.
const ALERT_NEXT_STATUS = { new: "acknowledged", acknowledged: "action_taken", action_taken: "resolved" };
const ALERT_ACTION_KEY = { acknowledged: "acknowledgeAlert", action_taken: "markActionTaken", resolved: "resolveAlert" };

// Officer-facing "My Weapons" view — the weapon(s) currently in the
// logged-in user's custody (each by its exact sub ID), their own custody
// history, and any ISSUE awaiting their confirmation of receipt.
//
// Returns work the other way round: the officer SUBMITS a return report
// from here (condition, rounds, accessories) and then waits — "Awaiting
// inventory check". Only the Inventory Officer can confirm it, after
// physically checking the weapon (see confirmTransaction in
// inventoryController.js); nothing in stock changes until they do. If
// they reject it, it comes back here under "Return rejected, please
// correct" and resubmitting replaces the rejected report.
const EMPTY_RETURN_FORM = {
  condition: "",
  faultReason: "",
  ammoReturned: "",
  ammoDeclaredUsed: "",
  accessoriesComplete: "",
  accessoriesRemarks: "",
};

function capRounds(value, max) {
  if (value === "") return "";
  const n = Math.max(0, Math.floor(Number(value)));
  if (Number.isNaN(n)) return "";
  return String(max > 0 ? Math.min(n, max) : n);
}

function holdingLabel(h) {
  const name = h.itemName ? ` — ${h.itemName}` : "";
  return `${h.subId || h.itemCode}${name}`;
}

export function WeaponManagementPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [pendingConfirmation, setPendingConfirmation] = useState([]);
  const [myAlerts, setMyAlerts] = useState([]);
  const [holdings, setHoldings] = useState([]);

  // The weapon whose return form is open, or null. returnForm is its draft.
  const [returningHolding, setReturningHolding] = useState(null);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN_FORM);
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [returnError, setReturnError] = useState("");

  const [confirmingTx, setConfirmingTx] = useState(null); // the pending transaction being confirmed, or null
  const [confirmRemarks, setConfirmRemarks] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  // Reject: the officer refusing a pending issue/return, with a reason.
  const [rejectingTx, setRejectingTx] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState("");

  // The alert currently open in the status-update modal, or null.
  const [actingAlert, setActingAlert] = useState(null);
  const [alertRemarks, setAlertRemarks] = useState("");
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const [alertError, setAlertError] = useState("");

  function loadData() {
    return Promise.all([getMyWeapons(), getMyAlerts()]).then(([weapons, alerts]) => {
      setHistory(weapons.history || []);
      setPendingConfirmation(weapons.pendingConfirmation || []);
      setHoldings(weapons.holdings || []);
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

  // Opens the return form for one weapon. If its last report was rejected,
  // the form starts from that report so the officer only fixes what's wrong.
  function openReturn(holding) {
    const prev = holding.returnStatus === "rejected" ? holding.returnTx : null;
    setReturningHolding(holding);
    setReturnError("");
    setReturnForm(
      prev
        ? {
            condition: prev.condition === "Faulty" ? "Faulty" : "Good",
            faultReason: prev.condition === "Faulty" ? prev.remarks || "" : "",
            ammoReturned: prev.ammoReturned == null ? "" : String(prev.ammoReturned),
            ammoDeclaredUsed: prev.ammoDeclaredUsed == null ? "" : String(prev.ammoDeclaredUsed),
            accessoriesComplete: prev.accessoriesComplete == null ? "" : String(prev.accessoriesComplete),
            accessoriesRemarks: prev.accessoriesRemarks || "",
          }
        : EMPTY_RETURN_FORM
    );
  }

  function closeReturn() {
    setReturningHolding(null);
    setReturnForm(EMPTY_RETURN_FORM);
    setReturnError("");
  }

  async function handleReturnSubmit() {
    const h = returningHolding;
    const f = returnForm;
    if (!f.condition) return setReturnError(t("weaponManagement.errReturnConditionRequired"));
    if (f.condition === "Faulty" && !f.faultReason.trim()) return setReturnError(t("weaponManagement.errReturnFaultReason"));
    if (h.ammoIssued && (f.ammoReturned === "" || f.ammoDeclaredUsed === "")) {
      return setReturnError(t("weaponManagement.errReturnRounds"));
    }
    if (f.accessoriesComplete === "") return setReturnError(t("weaponManagement.errReturnAccessories"));
    if (f.accessoriesComplete === "false" && !f.accessoriesRemarks.trim()) {
      return setReturnError(t("weaponManagement.errReturnAccessoriesNote"));
    }

    setReturnSubmitting(true);
    setReturnError("");
    try {
      await submitMyReturn({
        itemId: h.itemId,
        subId: h.subId || undefined,
        condition: f.condition,
        remarks: f.condition === "Faulty" ? f.faultReason.trim() : undefined,
        // Rounds only exist on the report if the weapon went out with ammunition.
        ammoReturned: h.ammoIssued ? Number(f.ammoReturned) : undefined,
        ammoDeclaredUsed: h.ammoIssued ? Number(f.ammoDeclaredUsed) : undefined,
        accessoriesComplete: f.accessoriesComplete === "true",
        accessoriesRemarks: f.accessoriesComplete === "false" ? f.accessoriesRemarks.trim() : undefined,
      });
      await loadData();
      closeReturn();
    } catch (err) {
      setReturnError(err.message || t("weaponManagement.errReturnFailed"));
    } finally {
      setReturnSubmitting(false);
    }
  }

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

  function openReject(tx) {
    setRejectingTx(tx);
    setRejectReason("");
    setRejectError("");
  }

  function closeReject() {
    setRejectingTx(null);
    setRejectReason("");
    setRejectError("");
  }

  async function handleReject() {
    if (rejectReason.trim().length < 3) {
      setRejectError(t("weaponManagement.errRejectReasonRequired"));
      return;
    }
    setRejecting(true);
    setRejectError("");
    try {
      await rejectTransaction(rejectingTx.id, rejectReason.trim());
      await loadData();
      closeReject();
    } catch (err) {
      setRejectError(err.message || t("weaponManagement.errRejectFailed"));
    } finally {
      setRejecting(false);
    }
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
  const returnsRejected = holdings.filter((h) => h.returnStatus === "rejected");
  const rejectingMeta = rejectingTx ? TRANSACTION_TYPE[rejectingTx.type] || TRANSACTION_TYPE.issue : null;
  // Issues this officer rejected, still waiting on the Inventory Officer's
  // review. (A rejected RETURN is the opposite — the officer has to fix it —
  // and is listed separately under "Return rejected, please correct".)
  const rejectedAwaitingReview = history.filter((tx) => tx.confirmationStatus === "rejected" && tx.type === "issue");

  const pendingColumns = [
    { key: "itemId", label: t("weaponManagement.colItemId"), render: (row) => itemLabel(row.itemId) },
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" onClick={() => openConfirm(row)}>
              {t(`weaponManagement.${meta.actionKey}`)}
            </Button>
            <Button variant="outline" onClick={() => openReject(row)}>
              {t("weaponManagement.reject")}
            </Button>
          </div>
        );
      },
    },
  ];

  const custodyColumns = [
    { key: "itemCode", label: t("weaponManagement.colItemId") },
    {
      key: "subId",
      label: t("weaponManagement.colSubId"),
      render: (row) => (row.subId ? <span className="subid-pill subid-issued">{row.subId}</span> : "—"),
    },
    { key: "itemName", label: t("weaponManagement.colItemName") },
    { key: "quantity", label: t("weaponManagement.colQuantity") },
    { key: "condition", label: t("weaponManagement.colCondition"), render: (row) => <Badge status={row.condition || "good"} /> },
    {
      key: "returnStatus",
      label: t("weaponManagement.colStatus"),
      render: (row) =>
        row.returnStatus === "pending" ? (
          <Badge tone="warning">{t("weaponManagement.awaitingInventoryCheck")}</Badge>
        ) : row.returnStatus === "rejected" ? (
          <Badge tone="danger" title={row.returnTx?.rejectionReason || undefined}>{t("weaponManagement.returnRejectedBadge")}</Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      label: "",
      render: (row) => {
        // One open report per weapon: while it's awaiting the check there is
        // nothing to submit, so no button at all.
        if (row.returnStatus === "pending") return null;
        return (
          <Button variant="primary" onClick={() => openReturn(row)}>
            {row.returnStatus === "rejected" ? t("weaponManagement.correctAndResubmit") : t("weaponManagement.returnWeapon")}
          </Button>
        );
      },
    },
  ];

  const historyColumns = [
    { key: "dateTime", label: t("weaponManagement.colDateTime"), render: (row) => formatDateAndTime(row.dateTime) },
    { key: "itemId", label: t("weaponManagement.colItemId"), render: (row) => itemLabel(row.itemId) },
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
          <Badge tone="warning">{row.type === "issue" ? t("weaponManagement.pending") : t("weaponManagement.awaitingInventoryCheck")}</Badge>
        ) : row.confirmationStatus === "rejected" ? (
          <Badge tone="danger" title={row.rejectionReason || undefined}>{t("weaponManagement.rejected")}</Badge>
        ) : row.confirmationStatus === "cancelled" ? (
          <Badge tone="info" title={row.rejectionReason || undefined}>{t("weaponManagement.cancelled")}</Badge>
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
    { key: "itemId", label: t("weaponManagement.colItemId"), render: (row) => itemLabel(row.itemId) },
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
        <StatCard label={t("weaponManagement.inCustody")} value={holdings.length} />
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

      {rejectedAwaitingReview.length > 0 && (
        <Card variant="panel" className="weapon-mgmt-section">
          <h3 className="section-label">{t("weaponManagement.rejectedTitle")}</h3>
          <p className="weapon-mgmt-section-subtitle">{t("weaponManagement.rejectedSubtitle")}</p>
          <Table
            columns={[
              { key: "itemId", label: t("weaponManagement.colItemId"), render: (row) => itemLabel(row.itemId) },
              {
                key: "type",
                label: t("weaponManagement.colTransactionType"),
                render: (row) => {
                  const meta = TRANSACTION_TYPE[row.type] || TRANSACTION_TYPE.issue;
                  return <Badge tone={meta.tone}>{t(`weaponManagement.${meta.labelKey}`)}</Badge>;
                },
              },
              { key: "rejectionReason", label: t("weaponManagement.rejectReasonLabel"), render: (row) => row.rejectionReason || "—" },
              { key: "rejectedAt", label: t("weaponManagement.colDateTime"), render: (row) => (row.rejectedAt ? formatDateAndTime(row.rejectedAt) : "—") },
            ]}
            data={rejectedAwaitingReview}
            emptyMessage=""
          />
        </Card>
      )}

      {returnsRejected.length > 0 && (
        <Card variant="panel" className="weapon-mgmt-section weapon-mgmt-pending">
          <h3 className="section-label">{t("weaponManagement.returnRejectedTitle")}</h3>
          <p className="weapon-mgmt-section-subtitle">{t("weaponManagement.returnRejectedSubtitle")}</p>
          <Table
            columns={[
              { key: "itemCode", label: t("weaponManagement.colItemId"), render: (row) => holdingLabel(row) },
              {
                key: "reason",
                label: t("weaponManagement.returnRejectedReason"),
                render: (row) => row.returnTx?.rejectionReason || "—",
              },
              {
                key: "rejectedAt",
                label: t("weaponManagement.colDateTime"),
                render: (row) => (row.returnTx?.rejectedAt ? formatDateAndTime(row.returnTx.rejectedAt) : "—"),
              },
              {
                key: "actions",
                label: "",
                render: (row) => (
                  <Button variant="primary" onClick={() => openReturn(row)}>
                    {t("weaponManagement.correctAndResubmit")}
                  </Button>
                ),
              },
            ]}
            data={returnsRejected}
            emptyMessage=""
          />
        </Card>
      )}

      <Card variant="panel" className="weapon-mgmt-section">
        <h3 className="section-label">{t("weaponManagement.inCustody")}</h3>
        <Table columns={custodyColumns} data={holdings} emptyMessage={t("weaponManagement.noWeaponsAssigned")} />
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
        open={Boolean(returningHolding)}
        onClose={closeReturn}
        title={
          returningHolding
            ? t(returningHolding.returnStatus === "rejected" ? "weaponManagement.resubmitModalTitle" : "weaponManagement.returnModalTitle")
            : ""
        }
        footer={
          <Button variant="primary" fullWidth onClick={handleReturnSubmit} disabled={returnSubmitting}>
            {returnSubmitting
              ? t("weaponManagement.submittingReturn")
              : returningHolding?.returnStatus === "rejected"
              ? t("weaponManagement.resubmitReturn")
              : t("weaponManagement.submitReturn")}
          </Button>
        }
      >
        {returningHolding && (
          <>
            <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
              {t("weaponManagement.returnModalText")}
            </p>
            {returningHolding.returnStatus === "rejected" && returningHolding.returnTx?.rejectionReason && (
              <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 16 }}>
                <strong>{t("weaponManagement.returnRejectedReason")}:</strong> {returningHolding.returnTx.rejectionReason}
              </p>
            )}
            <div className="weapon-mgmt-confirm-details">
              <p><strong>{t("weaponManagement.returnWeaponLabel")}:</strong> {holdingLabel(returningHolding)}</p>
              {returningHolding.accessories && (
                <p><strong>{t("weaponManagement.issuedWithLabel")}:</strong> {returningHolding.accessories}</p>
              )}
            </div>

            <InputField
              label={t("weaponManagement.returnConditionLabel")}
              type="select"
              required
              value={returnForm.condition}
              placeholder={t("weaponManagement.selectOption")}
              onChange={(e) =>
                setReturnForm((f) => ({ ...f, condition: e.target.value, faultReason: e.target.value === "Faulty" ? f.faultReason : "" }))
              }
              options={[
                { value: "Good", label: t("weaponManagement.conditionGood") },
                { value: "Faulty", label: t("weaponManagement.conditionFaulty") },
              ]}
            />
            {returnForm.condition === "Faulty" && (
              <InputField
                label={t("weaponManagement.faultReasonLabel")}
                type="textarea"
                rows={3}
                required
                value={returnForm.faultReason}
                placeholder={t("weaponManagement.faultReasonPlaceholder")}
                onChange={(e) => setReturnForm((f) => ({ ...f, faultReason: e.target.value }))}
                voiceInput
                sinhalaTyping
              />
            )}

            {returningHolding.ammoIssued ? (
              <>
                <p className="weapon-mgmt-section-subtitle">
                  {t("weaponManagement.roundsIssued")}: {returningHolding.ammoIssued}
                  {returningHolding.ammoItemName ? ` × ${returningHolding.ammoItemName}` : ""}
                </p>
                <InputField
                  label={t("weaponManagement.roundsHandedBack")}
                  type="number"
                  min="0"
                  max={returningHolding.ammoIssued}
                  required
                  value={returnForm.ammoReturned}
                  helperText={t("weaponManagement.maxRounds").replace("{n}", returningHolding.ammoIssued)}
                  onChange={(e) => setReturnForm((f) => ({ ...f, ammoReturned: capRounds(e.target.value, returningHolding.ammoIssued) }))}
                />
                <InputField
                  label={t("weaponManagement.roundsFired")}
                  type="number"
                  min="0"
                  max={returningHolding.ammoIssued}
                  required
                  value={returnForm.ammoDeclaredUsed}
                  helperText={t("weaponManagement.maxRounds").replace("{n}", returningHolding.ammoIssued)}
                  onChange={(e) => setReturnForm((f) => ({ ...f, ammoDeclaredUsed: capRounds(e.target.value, returningHolding.ammoIssued) }))}
                />
              </>
            ) : (
              <p className="weapon-mgmt-section-subtitle">{t("weaponManagement.noAmmoIssued")}</p>
            )}

            <InputField
              label={t("weaponManagement.accessoriesAllBackQ")}
              type="select"
              required
              value={returnForm.accessoriesComplete}
              placeholder={t("weaponManagement.selectOption")}
              onChange={(e) =>
                setReturnForm((f) => ({
                  ...f,
                  accessoriesComplete: e.target.value,
                  accessoriesRemarks: e.target.value === "false" ? f.accessoriesRemarks : "",
                }))
              }
              options={[
                { value: "true", label: t("weaponManagement.yes") },
                { value: "false", label: t("weaponManagement.no") },
              ]}
            />
            {returnForm.accessoriesComplete === "false" && (
              <InputField
                label={t("weaponManagement.accessoriesNoteLabel")}
                required
                value={returnForm.accessoriesRemarks}
                placeholder={t("weaponManagement.accessoriesNotePlaceholder")}
                onChange={(e) => setReturnForm((f) => ({ ...f, accessoriesRemarks: e.target.value }))}
              />
            )}
            {returnError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{returnError}</p>}
          </>
        )}
      </Modal>

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
            <p><strong>{t("weaponManagement.colItemId")}:</strong> {itemLabel(confirmingTx.itemId)}</p>
            <p><strong>{t("weaponManagement.colQuantity")}:</strong> {confirmingTx.quantity}</p>
            {isReturnLike && <p><strong>{t("weaponManagement.colCondition")}:</strong> {confirmingTx.condition || "—"}</p>}
            {!isReturnLike && confirmingTx.ammoIssued > 0 && (
              <p>
                <strong>{t("weaponManagement.ammoIssued")}:</strong> {confirmingTx.ammoIssued}
                {confirmingTx.ammoItemId?.itemName ? ` × ${confirmingTx.ammoItemId.itemName}` : ""}
              </p>
            )}
            {confirmingTx.accessories && (
              <p><strong>{t("weaponManagement.accessories")}:</strong> {confirmingTx.accessories}</p>
            )}
            {isReturnLike && confirmingTx.accessoriesComplete === false && (
              <p style={{ color: "var(--color-danger)" }}>
                <strong>{t("weaponManagement.accessoriesMissing")}:</strong> {confirmingTx.accessoriesRemarks || "—"}
              </p>
            )}
            {isReturnLike && (confirmingTx.ammoIssued !== null || confirmingTx.ammoReturned !== null) && (
              <>
                <p><strong>{t("weaponManagement.ammoIssued")}:</strong> {confirmingTx.ammoIssued ?? "—"}</p>
                <p><strong>{t("weaponManagement.ammoReturned")}:</strong> {confirmingTx.ammoReturned ?? "—"}</p>
                <p><strong>{t("weaponManagement.ammoUsed")}:</strong> {confirmingTx.ammoUsed ?? "—"}</p>
                {confirmingTx.ammoDeclaredUsed !== null && confirmingTx.ammoDeclaredUsed !== undefined && (
                  <p><strong>{t("weaponManagement.ammoDeclaredUsed")}:</strong> {confirmingTx.ammoDeclaredUsed}</p>
                )}
                {confirmingTx.ammoDiscrepancy !== null && confirmingTx.ammoDiscrepancy !== undefined && confirmingTx.ammoDiscrepancy !== 0 && (
                  <p style={{ color: "var(--color-danger)" }}>
                    <strong>{t("weaponManagement.ammoDiscrepancy")}:</strong> {Math.abs(confirmingTx.ammoDiscrepancy)}{" "}
                    {t("weaponManagement.roundsFlagged")}
                  </p>
                )}
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
        open={Boolean(rejectingTx)}
        onClose={closeReject}
        title={rejectingMeta ? t("weaponManagement.rejectTitle") : ""}
        footer={
          <Button variant="primary" fullWidth onClick={handleReject} disabled={rejecting}>
            {rejecting ? t("weaponManagement.rejecting") : t("weaponManagement.reject")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("weaponManagement.rejectText")}
        </p>
        {rejectingTx && (
          <div className="weapon-mgmt-confirm-details">
            <p><strong>{t("weaponManagement.colItemId")}:</strong> {itemLabel(rejectingTx.itemId)}</p>
            <p><strong>{t("weaponManagement.colTransactionType")}:</strong> {rejectingMeta ? t(`weaponManagement.${rejectingMeta.labelKey}`) : "—"}</p>
            <p><strong>{t("weaponManagement.colProcessedBy")}:</strong> {rejectingTx.processedBy?.fullName || rejectingTx.processedBy?.rankAndNumber || "—"}</p>
            <p><strong>{t("weaponManagement.colDateTime")}:</strong> {formatDateAndTime(rejectingTx.dateTime)}</p>
          </div>
        )}
        <InputField
          label={t("weaponManagement.rejectReasonLabel")}
          type="textarea"
          rows={3}
          required
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder={t("weaponManagement.rejectReasonPlaceholder")}
          voiceInput
          sinhalaTyping
        />
        {rejectError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{rejectError}</p>}
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
            <p><strong>{t("weaponManagement.colItemId")}:</strong> {itemLabel(actingAlert.itemId)}</p>
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