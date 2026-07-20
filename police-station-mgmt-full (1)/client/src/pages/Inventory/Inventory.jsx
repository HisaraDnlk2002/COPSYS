import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, StatCard, Table, Loader, Modal } from "../../components";
import {
  getInventoryStats,
  getInventoryItems,
  getIssueTransactions,
  getReturnTransactions,
  getDamagedRecords,
  addInventoryItem,
  issueItem,
  returnItem as returnItemRequest,
} from "../../services/inventory";
import "./Inventory.css";

const EMPTY_ISSUE_FORM = { officerId: "", weaponSerialId: "", quantity: "", deploymentDate: "" };
const EMPTY_RETURN_FORM = { officerId: "", weaponSerialId: "", returnDate: "", condition: "" };
const EMPTY_ADD_FORM = { officerId: "", weaponSerialId: "", quantity: "", weaponType: "" };

export function InventoryPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canManage = user?.role === "inventory_officer";

  const TABS = [
    { key: "weapons", label: t("inventory.tabWeapons") },
    { key: "issue", label: t("inventory.tabIssue") },
    { key: "return", label: t("inventory.tabReturn") },
    { key: "damaged", label: t("inventory.tabDamaged") },
  ];

  const [activeTab, setActiveTab] = useState("weapons");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [issueTx, setIssueTx] = useState([]);
  const [returnTx, setReturnTx] = useState([]);
  const [damagedTx, setDamagedTx] = useState([]);

  const [openModal, setOpenModal] = useState(null); // null | "issue" | "return" | "add"
  const [issueForm, setIssueForm] = useState(EMPTY_ISSUE_FORM);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN_FORM);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getInventoryStats(),
      getInventoryItems(),
      getIssueTransactions(),
      getReturnTransactions(),
      getDamagedRecords(),
    ])
      .then(([statsRes, itemsRes, issueRes, returnRes, damagedRes]) => {
        if (cancelled) return;
        setStats(statsRes);
        setItems(itemsRes);
        setIssueTx(issueRes);
        setReturnTx(returnRes);
        setDamagedTx(damagedRes);
      })
      .catch((err) => console.error("Failed to load inventory:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function closeModal() {
    setOpenModal(null);
    setIssueForm(EMPTY_ISSUE_FORM);
    setReturnForm(EMPTY_RETURN_FORM);
    setAddForm(EMPTY_ADD_FORM);
  }

  async function handleIssueSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const tx = await issueItem(issueForm.weaponSerialId, {
        officerName: issueForm.officerId,
        dutyType: "Patrol",
        dateTime: issueForm.deploymentDate,
        quantity: issueForm.quantity,
      });
      setIssueTx((prev) => [tx, ...prev]);
      closeModal();
    } catch (err) {
      console.error("Issue failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReturnSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const tx = await returnItemRequest(returnForm.weaponSerialId, {
        officerName: returnForm.officerId,
        dutyType: "Patrol",
        dateTime: returnForm.returnDate,
        condition: returnForm.condition,
      });
      setReturnTx((prev) => [tx, ...prev]);
      closeModal();
    } catch (err) {
      console.error("Return failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const item = await addInventoryItem({
        itemId: addForm.weaponSerialId,
        itemName: addForm.weaponType,
        category: "Firearms",
        quantity: Number(addForm.quantity) || 0,
      });
      setItems((prev) => [item, ...prev]);
      closeModal();
    } catch (err) {
      console.error("Add item failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loader label={t("inventory.loading")} />;

  const ledgerColumns = [
    { key: "itemId", label: t("inventory.colItemId") },
    { key: "itemName", label: t("inventory.colItemName") },
    { key: "category", label: t("inventory.colCategory") },
    { key: "quantity", label: t("inventory.colQuantity") },
    { key: "status", label: t("common.status") },
  ];

  const issueColumns = [
    { key: "itemId", label: t("inventory.colItemId") },
    { key: "officerName", label: t("inventory.colOfficerName") },
    { key: "dutyType", label: t("inventory.colDutyType") },
    { key: "dateTime", label: t("inventory.colDateTime") },
    { key: "status", label: t("common.status") },
  ];

  const returnColumns = [
    { key: "itemId", label: t("inventory.colItemId") },
    { key: "officerName", label: t("inventory.colOfficerName") },
    { key: "dutyType", label: t("inventory.colDutyType") },
    { key: "dateTime", label: t("inventory.colDateTime") },
    { key: "condition", label: t("inventory.colCondition") },
    { key: "remarks", label: t("inventory.colRemarks") },
  ];

  return (
    <div>
      <div className="inventory-header">
        <h1>{t("inventory.dashboardTitle")}</h1>
        {canManage && (
          <div className="inventory-header-actions">
            <Button variant="outline" onClick={() => setOpenModal("issue")}>{t("inventory.issueItem")}</Button>
            <Button variant="outline" onClick={() => setOpenModal("return")}>{t("inventory.returnItem")}</Button>
            <Button variant="primary" onClick={() => setOpenModal("add")}>{t("inventory.addNewItem")}</Button>
          </div>
        )}
      </div>
      <p className="inventory-subtitle">{t("inventory.stationAssetRegistry")} {stats?.stationLabel}</p>

      <div className="stat-grid">
        <StatCard label={t("inventory.totalAssets")} value={stats?.totalAssets} caption={t("inventory.allCategoriesCombined")} />
        <StatCard label={t("inventory.issuedItems")} value={stats?.issuedItems} caption={t("inventory.currentlyInUse")} />
        <StatCard label={t("inventory.availableStock")} value={stats?.availableStock} caption={t("inventory.readyForDeployment")} />
        <StatCard label={t("inventory.damagedRepairs")} value={stats?.damagedRepairs} caption={t("inventory.requiresAttention")} />
      </div>

      <div className="inventory-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`inventory-tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card variant="panel">
        {activeTab === "weapons" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.equipmentLedgerTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.equipmentLedgerSubtitle")}</p>
            <Table columns={ledgerColumns} data={items} emptyMessage={t("inventory.noInventoryItems")} />
            <div className="inventory-footer-row">
              <span>{t("inventory.showingItems")} {items.length} / {stats?.totalAssets ?? items.length} {t("inventory.ofItemsRegistered")}</span>
            </div>
          </>
        )}

        {activeTab === "issue" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.issuingLogTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.issuingLogSubtitle")}</p>
            <Table columns={issueColumns} data={issueTx} emptyMessage={t("inventory.noItemsIssued")} />
          </>
        )}

        {activeTab === "return" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.returnedLogTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.returnedLogSubtitle")}</p>
            <Table columns={returnColumns} data={returnTx} emptyMessage={t("inventory.noReturnsRecorded")} />
          </>
        )}

        {activeTab === "damaged" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.damagedRecordsTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.damagedRecordsSubtitle")}</p>
            <Table columns={returnColumns} data={damagedTx} emptyMessage={t("inventory.noDamagedItems")} />
          </>
        )}
      </Card>

      <Modal
        open={openModal === "issue"}
        onClose={closeModal}
        title={t("inventory.issueItemForm")}
        footer={
          <Button variant="primary" fullWidth onClick={handleIssueSubmit} disabled={submitting}>
            {submitting ? t("inventory.processing") : t("inventory.confirmIssueTransaction")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.recordIssuingText")}
        </p>
        <div className="modal-form-grid">
          <InputField label={t("inventory.officerId")} value={issueForm.officerId} onChange={(e) => setIssueForm((f) => ({ ...f, officerId: e.target.value }))} />
          <InputField label={t("inventory.weaponSerialId")} value={issueForm.weaponSerialId} onChange={(e) => setIssueForm((f) => ({ ...f, weaponSerialId: e.target.value }))} />
          <InputField label={t("inventory.quantityToIssue")} value={issueForm.quantity} onChange={(e) => setIssueForm((f) => ({ ...f, quantity: e.target.value }))} />
          <InputField label={t("inventory.deploymentDate")} type="date" value={issueForm.deploymentDate} onChange={(e) => setIssueForm((f) => ({ ...f, deploymentDate: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        open={openModal === "return"}
        onClose={closeModal}
        title={t("inventory.returnItemForm")}
        footer={
          <Button variant="primary" fullWidth onClick={handleReturnSubmit} disabled={submitting}>
            {submitting ? t("inventory.processing") : t("inventory.processReturnAudit")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.recordReturningText")}
        </p>
        <div className="modal-form-grid">
          <InputField label={t("inventory.officerId")} value={returnForm.officerId} onChange={(e) => setReturnForm((f) => ({ ...f, officerId: e.target.value }))} />
          <InputField label={t("inventory.weaponSerialId")} value={returnForm.weaponSerialId} onChange={(e) => setReturnForm((f) => ({ ...f, weaponSerialId: e.target.value }))} />
          <InputField label={t("inventory.returnDate")} type="date" value={returnForm.returnDate} onChange={(e) => setReturnForm((f) => ({ ...f, returnDate: e.target.value }))} />
          <InputField label={t("inventory.weaponCondition")} value={returnForm.condition} onChange={(e) => setReturnForm((f) => ({ ...f, condition: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        open={openModal === "add"}
        onClose={closeModal}
        title={t("inventory.addNewItemForm")}
        footer={
          <Button variant="primary" fullWidth onClick={handleAddSubmit} disabled={submitting}>
            {submitting ? t("inventory.processing") : t("inventory.confirmAdd")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.recordNewItemText")}
        </p>
        <div className="modal-form-grid">
          <InputField label={t("inventory.officerId")} value={addForm.officerId} onChange={(e) => setAddForm((f) => ({ ...f, officerId: e.target.value }))} />
          <InputField label={t("inventory.weaponSerialId")} value={addForm.weaponSerialId} onChange={(e) => setAddForm((f) => ({ ...f, weaponSerialId: e.target.value }))} />
          <InputField label={t("inventory.quantityToAdd")} value={addForm.quantity} onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))} />
          <InputField label={t("inventory.weaponType")} value={addForm.weaponType} onChange={(e) => setAddForm((f) => ({ ...f, weaponType: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}
