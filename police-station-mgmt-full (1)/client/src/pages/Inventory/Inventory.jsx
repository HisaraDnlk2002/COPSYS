import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, InputField, Card, StatCard, Table, Loader, Modal, SearchableSelect, Badge } from "../../components";
import {
  getInventoryStats,
  getInventoryItems,
  getIssueTransactions,
  getReturnTransactions,
  getDamagedRecords,
  addInventoryItem,
  issueItem,
  returnItem as returnItemRequest,
  reportMissing,
} from "../../services/inventory";
import { getMaintenanceRecords, updateMaintenanceRecord } from "../../services/maintenance";
import { getInspections, createInspection } from "../../services/inspections";
import { getAlerts, updateAlertStatus } from "../../services/alerts";
import { searchOfficers } from "../../services/officers";
import { formatDate } from "../../utils/formatDate";
import "./Inventory.css";

// How soon before nextInspectionDate a weapon counts as "due soon"
// rather than just "on schedule" — purely a display threshold, doesn't
// affect anything server-side.
const INSPECTION_DUE_SOON_DAYS = 14;

// Same lookup as the shared officer search, but labeled by Rank &
// Number instead of phone number — that's the officer's actual ID
// elsewhere in this app (login username, Personnel table), so it's the
// more useful thing to see and log here regardless of whether you
// searched by name or by rank number (the server matches either).
async function searchOfficersByRank(query) {
  const officers = await searchOfficers(query);
  return officers.map((o) => ({ ...o, label: `${o.fullName} — ${o.rankAndNumber}` }));
}

// officer/item start out unselected ({ value, label } from SearchableSelect,
// not free text) — see handleIssueSubmit/handleReturnSubmit for why that
// matters: the backend needs real ids, not whatever was typed.
const EMPTY_ISSUE_FORM = { officer: null, item: null, quantity: "", deploymentDate: "", expectedReturnDate: "" };
const EMPTY_RETURN_FORM = { officer: null, item: null, quantity: "", returnDate: "", condition: "", ammoIssued: "", ammoReturned: "" };
const EMPTY_ADD_FORM = { weaponSerialId: "", quantity: "", weaponType: "", category: "" };

export function InventoryPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canManage = user?.role === "inventory_officer";

  // No standalone "Damaged" tab — damaged-type transactions still get
  // fetched (damagedTx feeds the combined Audit Ledger tab below) but a
  // dedicated tab for them was redundant with Audit Ledger's Type filter
  // and the Maintenance tab, which is where a damaged weapon's actual
  // repair workflow lives now.
  const TABS = [
    { key: "weapons", label: t("inventory.tabWeapons") },
    { key: "issue", label: t("inventory.tabIssue") },
    { key: "return", label: t("inventory.tabReturn") },
    { key: "ledger", label: t("inventory.tabLedger") },
    { key: "maintenance", label: t("inventory.tabMaintenance") },
    { key: "inspections", label: t("inventory.tabInspections") },
    { key: "alerts", label: t("inventory.tabAlerts") },
  ];

  const [activeTab, setActiveTab] = useState("weapons");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [issueTx, setIssueTx] = useState([]);
  const [returnTx, setReturnTx] = useState([]);
  const [damagedTx, setDamagedTx] = useState([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState([]);
  const [inspectionRecords, setInspectionRecords] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const [openModal, setOpenModal] = useState(null); // null | "issue" | "return" | "add"
  const [issueForm, setIssueForm] = useState(EMPTY_ISSUE_FORM);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN_FORM);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // "all" | "issue" | "return" | "damaged" — only used on the "ledger" tab
  const [priorityFilter, setPriorityFilter] = useState("all"); // "all" | "critical" | "warning" | "info" — only used on the "alerts" tab
  const [alertStatusFilter, setAlertStatusFilter] = useState("all"); // "all" | "new" | "acknowledged" | "action_taken" | "resolved"

  // The maintenance record currently open in the manage modal, or null.
  // Its own fields double as the form state (editing this object
  // directly, then diffing what changed into the PATCH payload) since
  // the modal's available actions depend entirely on record.status.
  const [managingRecord, setManagingRecord] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState(null);
  const [maintenanceSubmitting, setMaintenanceSubmitting] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState("");

  // The Inventory item currently open in the inspect modal, or null.
  const [inspectingItem, setInspectingItem] = useState(null);
  const [inspectionForm, setInspectionForm] = useState(null);
  const [inspectionSubmitting, setInspectionSubmitting] = useState(false);
  const [inspectionError, setInspectionError] = useState("");

  // The Inventory item currently open in the "Report Missing" modal, or null.
  const [reportingMissingItem, setReportingMissingItem] = useState(null);
  const [missingRemarks, setMissingRemarks] = useState("");
  const [missingSubmitting, setMissingSubmitting] = useState(false);
  const [missingError, setMissingError] = useState("");

  // The alert currently open in the status-update modal, or null.
  const [actingAlert, setActingAlert] = useState(null);
  const [alertRemarks, setAlertRemarks] = useState("");
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const [alertError, setAlertError] = useState("");

  function loadAll() {
    return Promise.all([
      getInventoryStats(),
      getInventoryItems(),
      getIssueTransactions(),
      getReturnTransactions(),
      getDamagedRecords(),
      getMaintenanceRecords(),
      getInspections(),
      getAlerts(),
    ]).then(([statsRes, itemsRes, issueRes, returnRes, damagedRes, maintenanceRes, inspectionRes, alertsRes]) => {
      setStats(statsRes);
      setItems(itemsRes);
      setIssueTx(issueRes);
      setReturnTx(returnRes);
      setDamagedTx(damagedRes);
      setMaintenanceRecords(maintenanceRes);
      setInspectionRecords(inspectionRes);
      setAlerts(alertsRes);
    });
  }

  useEffect(() => {
    let cancelled = false;
    loadAll()
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
    setModalError("");
  }

  // Search-as-you-type over the already-loaded item ledger — there's no
  // server-side item search endpoint, so this filters client-side. Kept
  // async to match SearchableSelect's searchFn contract.
  async function searchIssuableItems(query) {
    const q = query.toLowerCase();
    return items
      .filter(
        (i) =>
          i.quantity > 0 &&
          i.status !== "damaged" &&
          i.status !== "missing" && // server blocks both too (see issue()) — filtered here as well so they're not offered at all
          (i.itemId.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q))
      )
      .map((i) => ({
        value: i.id,
        label: `${i.itemId} — ${i.itemName}`,
        subtitle: `${t("inventory.colQuantity")}: ${i.quantity} · ${i.category}`,
        quantity: i.quantity,
      }));
  }

  // "System loads the officer's currently issued weapon" — the Return
  // modal's item picker is scoped to whichever officer is selected
  // first, rather than searching the whole ledger. Returns nothing
  // until an officer is chosen. minChars={0} on the field itself makes
  // this run (with an empty query) as soon as it's focused, so the
  // officer's issued weapon(s) show immediately rather than requiring
  // the Inventory Officer to type anything.
  async function searchOfficerIssuedItems(query) {
    if (!returnForm.officer) return [];
    const q = query.toLowerCase();
    return items
      .filter(
        (i) =>
          i.assignedTo === returnForm.officer.value &&
          i.status === "issued" &&
          (i.itemId.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q))
      )
      .map((i) => ({
        value: i.id,
        label: `${i.itemId} — ${i.itemName}`,
        subtitle: i.category,
      }));
  }

  async function handleIssueSubmit(e) {
    e.preventDefault();
    setModalError("");

    if (!issueForm.item || !issueForm.officer || !issueForm.quantity) {
      setModalError(t("inventory.errRequiredFields"));
      return;
    }

    setSubmitting(true);
    try {
      await issueItem(issueForm.item.value, {
        officerId: issueForm.officer.value,
        dutyType: "Patrol",
        dateTime: issueForm.deploymentDate,
        quantity: Number(issueForm.quantity),
        expectedReturnDate: issueForm.expectedReturnDate || undefined,
      });
      await loadAll();
      closeModal();
    } catch (err) {
      setModalError(err.message || t("inventory.errIssueFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReturnSubmit(e) {
    e.preventDefault();
    setModalError("");

    if (!returnForm.item || !returnForm.officer || !returnForm.quantity || !returnForm.condition) {
      setModalError(t("inventory.errRequiredFields"));
      return;
    }
    if (
      returnForm.ammoIssued !== "" &&
      returnForm.ammoReturned !== "" &&
      Number(returnForm.ammoReturned) > Number(returnForm.ammoIssued)
    ) {
      setModalError(t("inventory.errAmmoDiscrepancy"));
      return;
    }

    setSubmitting(true);
    try {
      await returnItemRequest(returnForm.item.value, {
        officerId: returnForm.officer.value,
        dateTime: returnForm.returnDate,
        quantity: Number(returnForm.quantity),
        condition: returnForm.condition,
        ammoIssued: returnForm.ammoIssued === "" ? undefined : Number(returnForm.ammoIssued),
        ammoReturned: returnForm.ammoReturned === "" ? undefined : Number(returnForm.ammoReturned),
      });
      await loadAll();
      closeModal();
    } catch (err) {
      setModalError(err.message || t("inventory.errReturnFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setModalError("");

    if (!addForm.weaponSerialId || !addForm.weaponType || !addForm.category || !addForm.quantity) {
      setModalError(t("inventory.errRequiredFields"));
      return;
    }

    setSubmitting(true);
    try {
      await addInventoryItem({
        itemId: addForm.weaponSerialId,
        itemName: addForm.weaponType,
        category: addForm.category,
        quantity: Number(addForm.quantity) || 0,
      });
      await loadAll();
      closeModal();
    } catch (err) {
      setModalError(err.message || t("inventory.errAddFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function openMaintenance(record) {
    setManagingRecord(record);
    setMaintenanceForm({
      assignedTechnician: record.assignedTechnician || "",
      maintenanceType: record.maintenanceType || "Repair",
      partsCost: record.partsCost || "",
      remarks: record.remarks || "",
      finalCondition: record.finalCondition || "good",
      finalInspectionPassed: "",
    });
    setMaintenanceError("");
  }

  function closeMaintenance() {
    setManagingRecord(null);
    setMaintenanceForm(null);
    setMaintenanceError("");
  }

  // nextStatus is undefined when just saving details (technician/type/
  // parts/remarks) without advancing the Pending -> In Progress ->
  // Completed lifecycle.
  async function handleMaintenanceSave(nextStatus) {
    setMaintenanceError("");

    if (nextStatus === "completed" && !maintenanceForm.finalInspectionPassed) {
      setMaintenanceError(t("inventory.errFinalInspectionRequired"));
      return;
    }

    setMaintenanceSubmitting(true);
    try {
      await updateMaintenanceRecord(managingRecord.id, {
        assignedTechnician: maintenanceForm.assignedTechnician,
        maintenanceType: maintenanceForm.maintenanceType,
        partsCost: maintenanceForm.partsCost,
        remarks: maintenanceForm.remarks,
        ...(nextStatus && { status: nextStatus }),
        ...(nextStatus === "completed" && {
          finalCondition: maintenanceForm.finalCondition,
          finalInspectionPassed: maintenanceForm.finalInspectionPassed === "pass",
        }),
      });
      await loadAll();
      closeMaintenance();
    } catch (err) {
      setMaintenanceError(err.message || t("inventory.errMaintenanceUpdateFailed"));
    } finally {
      setMaintenanceSubmitting(false);
    }
  }

  function openInspect(item) {
    setInspectingItem(item);
    setInspectionForm({
      inspectionType: "Scheduled",
      condition: item.condition === "damaged" ? "damaged" : "good",
      findings: "",
      damageIssues: "",
      accessoriesChecked: "",
      remarks: "",
      result: "",
    });
    setInspectionError("");
  }

  function closeInspect() {
    setInspectingItem(null);
    setInspectionForm(null);
    setInspectionError("");
  }

  async function handleInspectionSubmit() {
    setInspectionError("");

    if (!inspectionForm.result) {
      setInspectionError(t("inventory.errInspectionResultRequired"));
      return;
    }

    setInspectionSubmitting(true);
    try {
      await createInspection({
        itemId: inspectingItem.id,
        ...inspectionForm,
      });
      await loadAll();
      closeInspect();
    } catch (err) {
      setInspectionError(err.message || t("inventory.errInspectionFailed"));
    } finally {
      setInspectionSubmitting(false);
    }
  }

  function openReportMissing(item) {
    setReportingMissingItem(item);
    setMissingRemarks("");
    setMissingError("");
  }

  function closeReportMissing() {
    setReportingMissingItem(null);
    setMissingRemarks("");
    setMissingError("");
  }

  async function handleReportMissingSubmit() {
    setMissingSubmitting(true);
    setMissingError("");
    try {
      await reportMissing(reportingMissingItem.id, missingRemarks);
      await loadAll();
      closeReportMissing();
    } catch (err) {
      setMissingError(err.message || t("inventory.errReportMissingFailed"));
    } finally {
      setMissingSubmitting(false);
    }
  }

  // nextStatus here is always the literal next step in
  // NEW -> ACKNOWLEDGED -> ACTION_TAKEN -> RESOLVED — the button that
  // opens this modal already knows which one that is (see
  // ALERT_NEXT_STATUS below), so there's no branching like
  // handleMaintenanceSave has.
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
      await loadAll();
      closeAlertAction();
    } catch (err) {
      setAlertError(err.message || t("inventory.errAlertUpdateFailed"));
    } finally {
      setAlertSubmitting(false);
    }
  }

  if (loading) return <Loader label={t("inventory.loading")} />;

  // The date range only applies to transaction tabs (issue/return/damaged)
  // — the weapons ledger has no dateTime field to filter on.
  function inDateRange(dateTimeValue) {
    if (!dateFrom && !dateTo) return true;
    const d = dateTimeValue?.slice(0, 10);
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }

  const q = search.trim().toLowerCase();

  // "Add New Item" offers whatever categories already exist in the
  // ledger, same idea as AuditLog's module filter (derived from real
  // data, not a hardcoded list that could drift from it) — seeded with
  // "Firearms" so the picker still has an option at a brand-new station
  // with nothing in the ledger yet.
  const existingCategories = [...new Set(["Firearms", ...items.map((i) => i.category).filter(Boolean)])].sort();

  const filteredItems = items.filter((i) => {
    if (!q) return true;
    return (
      i.itemId?.toLowerCase().includes(q) ||
      i.itemName?.toLowerCase().includes(q) ||
      i.category?.toLowerCase().includes(q)
    );
  });

  function filterTransactions(list) {
    return list.filter((tx) => {
      if (!inDateRange(tx.dateTime)) return false;
      if (!q) return true;
      return (
        tx.itemId?.itemId?.toLowerCase().includes(q) ||
        tx.itemId?.itemName?.toLowerCase().includes(q) ||
        tx.officerId?.fullName?.toLowerCase().includes(q) ||
        tx.officerId?.rankAndNumber?.toLowerCase().includes(q) ||
        tx.processedBy?.fullName?.toLowerCase().includes(q) ||
        tx.remarks?.toLowerCase().includes(q)
      );
    });
  }

  const filteredIssueTx = filterTransactions(issueTx);
  const filteredReturnTx = filterTransactions(returnTx);

  // Combined "Audit Ledger" tab — all three transaction types together,
  // newest first, instead of segregated by type like the other tabs.
  // Built from what's already loaded rather than a new endpoint; each
  // transaction already carries its own `type`, so no reshaping needed.
  const allTx = [...issueTx, ...returnTx, ...damagedTx].sort(
    (a, b) => new Date(b.dateTime) - new Date(a.dateTime)
  );
  const filteredLedgerTx = filterTransactions(allTx).filter(
    (tx) => typeFilter === "all" || tx.type === typeFilter
  );

  const filteredMaintenanceRecords = maintenanceRecords.filter((r) => {
    if (!inDateRange(r.reportedDate)) return false;
    if (!q) return true;
    return (
      r.refId?.toLowerCase().includes(q) ||
      r.itemId?.itemId?.toLowerCase().includes(q) ||
      r.itemId?.itemName?.toLowerCase().includes(q) ||
      r.issueDescription?.toLowerCase().includes(q) ||
      r.reportedBy?.fullName?.toLowerCase().includes(q) ||
      r.assignedTechnician?.toLowerCase().includes(q)
    );
  });

  const filteredInspectionRecords = inspectionRecords.filter((r) => {
    if (!inDateRange(r.inspectionDate)) return false;
    if (!q) return true;
    return (
      r.refId?.toLowerCase().includes(q) ||
      r.itemId?.itemId?.toLowerCase().includes(q) ||
      r.itemId?.itemName?.toLowerCase().includes(q) ||
      r.inspectedBy?.fullName?.toLowerCase().includes(q) ||
      r.findings?.toLowerCase().includes(q)
    );
  });

  // Everything physically in the armory (not out with an officer, and
  // not currently missing) is eligible for a "Due Inspections" alert —
  // that's the whole point of this flow: catching weapons nobody's
  // touched via Issue/Return/Maintenance in a while. Sorted soonest-due
  // first so the most urgent items are at the top.
  const inspectableItems = items
    .filter((i) => i.status !== "issued" && i.status !== "missing")
    .slice()
    .sort((a, b) => {
      if (!a.nextInspectionDate) return 1;
      if (!b.nextInspectionDate) return -1;
      return new Date(a.nextInspectionDate) - new Date(b.nextInspectionDate);
    });

  const nowDate = new Date();
  const today = nowDate.toISOString().slice(0, 10);
  const dueSoonCutoff = new Date(nowDate.getTime() + INSPECTION_DUE_SOON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  function inspectionAlert(item) {
    if (item.status === "damaged") return { labelKey: "alertFailed", tone: "danger" };
    const due = item.nextInspectionDate?.slice(0, 10);
    if (!due) return null;
    if (due < today) return { labelKey: "alertOverdue", tone: "danger" };
    if (due <= dueSoonCutoff) return { labelKey: "alertDueSoon", tone: "warning" };
    return null;
  }

  const overdueCount = inspectableItems.filter((i) => inspectionAlert(i)?.labelKey === "alertOverdue").length;
  const dueSoonCount = inspectableItems.filter((i) => inspectionAlert(i)?.labelKey === "alertDueSoon").length;

  const filteredAlerts = alerts.filter((a) => {
    if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
    if (alertStatusFilter !== "all" && a.status !== alertStatusFilter) return false;
    if (!inDateRange(a.generatedAt)) return false;
    if (!q) return true;
    return (
      a.refId?.toLowerCase().includes(q) ||
      a.title?.toLowerCase().includes(q) ||
      a.itemId?.itemId?.toLowerCase().includes(q) ||
      a.itemId?.itemName?.toLowerCase().includes(q) ||
      a.recipientId?.fullName?.toLowerCase().includes(q)
    );
  });
  const openAlertsCount = alerts.filter((a) => a.status !== "resolved").length;
  const criticalAlertsCount = alerts.filter((a) => a.priority === "critical" && a.status !== "resolved").length;

  const filtersActive = Boolean(
    search.trim() || dateFrom || dateTo || typeFilter !== "all" || priorityFilter !== "all" || alertStatusFilter !== "all"
  );

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setTypeFilter("all");
    setPriorityFilter("all");
    setAlertStatusFilter("all");
  }

  const ledgerColumns = [
    { key: "itemId", label: t("inventory.colItemId") },
    { key: "itemName", label: t("inventory.colItemName") },
    { key: "category", label: t("inventory.colCategory") },
    { key: "quantity", label: t("inventory.colQuantity") },
    { key: "status", label: t("common.status"), render: (row) => <Badge status={row.status} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "",
            render: (row) =>
              row.status === "issued" ? (
                <Button variant="ghost" onClick={() => openReportMissing(row)}>
                  {t("inventory.reportMissing")}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  // itemId/officerId/processedBy come back as populated sub-documents
  // (see listTransactions in inventoryController.js), not plain strings
  // — all three need a render accessor rather than the raw row[key]
  // lookup, or React throws trying to render an object.
  //
  // NOTE: InventoryTransaction has no "status" field — every prior
  // version of this table had a "Status" column bound to row.status,
  // which was always blank. Swapped for "Processed By" (processedBy),
  // which is real data and wasn't shown anywhere before.

  // Display-only — deliberately no click handler, dropdown, or any other
  // control here. The receiving officer's own confirmation (My Weapons
  // page -> confirmReceipt) is the only thing that can move this from
  // pending to secured; the Inventory Officer can only ever look.
  function renderConfirmation(row) {
    if (row.confirmationStatus === "secured") {
      return <Badge tone="success" title={row.confirmationRemarks || undefined}>{t("inventory.secured")}</Badge>;
    }
    if (row.confirmationStatus === "pending") {
      return <Badge tone="warning">{t("inventory.pendingConfirmation")}</Badge>;
    }
    return "—";
  }

  const issueColumns = [
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "officerId", label: t("inventory.colOfficerName"), render: (row) => row.officerId?.fullName || row.officerId?.rankAndNumber || "—" },
    { key: "dutyType", label: t("inventory.colDutyType") },
    { key: "dateTime", label: t("inventory.colDateTime") },
    { key: "confirmationStatus", label: t("inventory.colConfirmation"), render: renderConfirmation },
    { key: "processedBy", label: t("inventory.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
  ];

  function renderAmmoUsed(row) {
    return row.ammoUsed === null || row.ammoUsed === undefined ? "—" : row.ammoUsed;
  }

  const returnColumns = [
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "officerId", label: t("inventory.colOfficerName"), render: (row) => row.officerId?.fullName || row.officerId?.rankAndNumber || "—" },
    { key: "dutyType", label: t("inventory.colDutyType") },
    { key: "dateTime", label: t("inventory.colDateTime") },
    { key: "condition", label: t("inventory.colCondition"), render: (row) => (row.condition ? <Badge status={row.condition} /> : "—") },
    { key: "ammoUsed", label: t("inventory.ammoUsed"), render: renderAmmoUsed },
    { key: "remarks", label: t("inventory.colRemarks"), render: (row) => row.remarks || "—" },
    { key: "confirmationStatus", label: t("inventory.colConfirmation"), render: renderConfirmation },
    { key: "processedBy", label: t("inventory.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
  ];

  const TX_TYPE = {
    issue: { labelKey: "typeIssue", tone: "info" },
    return: { labelKey: "typeReturn", tone: "success" },
    damaged: { labelKey: "typeDamaged", tone: "danger" },
  };
  const ledgerTxColumns = [
    { key: "dateTime", label: t("inventory.colDateTime") },
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    {
      key: "type",
      label: t("inventory.colType"),
      render: (row) => {
        const meta = TX_TYPE[row.type];
        return meta ? <Badge tone={meta.tone}>{t(`inventory.${meta.labelKey}`)}</Badge> : "—";
      },
    },
    { key: "officerId", label: t("inventory.colOfficerName"), render: (row) => row.officerId?.fullName || row.officerId?.rankAndNumber || "—" },
    { key: "quantity", label: t("inventory.colQuantity") },
    { key: "condition", label: t("inventory.colCondition"), render: (row) => (row.condition ? <Badge status={row.condition} /> : "—") },
    { key: "ammoUsed", label: t("inventory.ammoUsed"), render: renderAmmoUsed },
    { key: "confirmationStatus", label: t("inventory.colConfirmation"), render: renderConfirmation },
    { key: "processedBy", label: t("inventory.colProcessedBy"), render: (row) => row.processedBy?.fullName || row.processedBy?.rankAndNumber || "—" },
  ];

  const MAINTENANCE_STATUS = {
    pending: { labelKey: "maintStatusPending", tone: "warning" },
    in_progress: { labelKey: "maintStatusInProgress", tone: "info" },
    completed: { labelKey: "maintStatusCompleted", tone: "success" },
  };
  const maintenanceColumns = [
    { key: "refId", label: t("inventory.colMaintenanceId") },
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "issueDescription", label: t("inventory.colIssueDescription") },
    { key: "reportedBy", label: t("inventory.colReportedBy"), render: (row) => row.reportedBy?.fullName || row.reportedBy?.rankAndNumber || "—" },
    { key: "reportedDate", label: t("inventory.colReportedDate"), render: (row) => formatDate(row.reportedDate) },
    { key: "maintenanceType", label: t("inventory.colMaintenanceType") },
    { key: "assignedTechnician", label: t("inventory.colAssignedTechnician"), render: (row) => row.assignedTechnician || "—" },
    {
      key: "status",
      label: t("common.status"),
      render: (row) => {
        const meta = MAINTENANCE_STATUS[row.status];
        return meta ? <Badge tone={meta.tone}>{t(`inventory.${meta.labelKey}`)}</Badge> : "—";
      },
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "",
            render: (row) => (
              <Button variant="ghost" onClick={() => openMaintenance(row)}>
                {row.status === "completed" ? t("common.view") : t("inventory.manage")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const dueInspectionColumns = [
    { key: "itemId", label: t("inventory.colItemId") },
    { key: "itemName", label: t("inventory.colItemName") },
    { key: "category", label: t("inventory.colCategory") },
    { key: "lastInspectionDate", label: t("inventory.colLastInspection"), render: (row) => (row.lastInspectionDate ? formatDate(row.lastInspectionDate) : "—") },
    { key: "nextInspectionDate", label: t("inventory.colNextInspection"), render: (row) => (row.nextInspectionDate ? formatDate(row.nextInspectionDate) : "—") },
    {
      key: "alert",
      label: t("inventory.colAlert"),
      render: (row) => {
        const alert = inspectionAlert(row);
        return alert ? <Badge tone={alert.tone}>{t(`inventory.${alert.labelKey}`)}</Badge> : <Badge tone="success">{t("inventory.alertOk")}</Badge>;
      },
    },
    ...(canManage
      ? [
          {
            key: "actions",
            label: "",
            render: (row) => (
              <Button variant="primary" onClick={() => openInspect(row)}>
                {t("inventory.inspect")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const inspectionHistoryColumns = [
    { key: "refId", label: t("inventory.colInspectionId") },
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "inspectedBy", label: t("inventory.colInspector"), render: (row) => row.inspectedBy?.fullName || row.inspectedBy?.rankAndNumber || "—" },
    { key: "inspectionDate", label: t("inventory.colInspectionDate"), render: (row) => formatDate(row.inspectionDate) },
    { key: "inspectionType", label: t("inventory.colInspectionType") },
    {
      key: "result",
      label: t("inventory.colResult"),
      render: (row) => (row.result === "passed" ? <Badge tone="success">{t("inventory.inspectionPassed")}</Badge> : <Badge tone="danger">{t("inventory.inspectionFailed")}</Badge>),
    },
    { key: "nextInspectionDate", label: t("inventory.colNextInspection"), render: (row) => (row.nextInspectionDate ? formatDate(row.nextInspectionDate) : "—") },
  ];

  const ALERT_PRIORITY_TONE = { critical: "danger", warning: "warning", info: "info" };
  const ALERT_PRIORITY_LABEL_KEY = { critical: "priorityCritical", warning: "priorityWarning", info: "priorityInfo" };
  const ALERT_STATUS_LABEL_KEY = { new: "alertStatusNew", acknowledged: "alertStatusAcknowledged", action_taken: "alertStatusActionTaken", resolved: "alertStatusResolved" };
  // The one step forward from each status — same "next status" idea as
  // MAINTENANCE_STATUS_TONE/handleMaintenanceSave, just for Alerts.
  const ALERT_NEXT_STATUS = { new: "acknowledged", acknowledged: "action_taken", action_taken: "resolved" };
  const ALERT_ACTION_LABEL_KEY = { acknowledged: "acknowledgeAlert", action_taken: "markActionTaken", resolved: "resolveAlert" };

  function formatDateTime(value) {
    if (!value) return "—";
    return `${formatDate(value)} ${value.slice(11, 16)}`;
  }

  const alertColumns = [
    { key: "refId", label: t("inventory.colAlertId") },
    {
      key: "priority",
      label: t("inventory.colPriority"),
      render: (row) => <Badge tone={ALERT_PRIORITY_TONE[row.priority]}>{t(`inventory.${ALERT_PRIORITY_LABEL_KEY[row.priority]}`)}</Badge>,
    },
    { key: "title", label: t("inventory.colAlertTitle"), render: (row) => (<span title={row.message || undefined}>{row.title}</span>) },
    { key: "itemId", label: t("inventory.colItemId"), render: (row) => row.itemId?.itemId || row.itemId?.itemName || "—" },
    { key: "generatedAt", label: t("inventory.colGeneratedAt"), render: (row) => formatDateTime(row.generatedAt) },
    { key: "recipientId", label: t("inventory.colRecipient"), render: (row) => row.recipientId?.fullName || row.recipientId?.rankAndNumber || "—" },
    {
      key: "status",
      label: t("common.status"),
      render: (row) => <Badge status={row.status}>{t(`inventory.${ALERT_STATUS_LABEL_KEY[row.status]}`)}</Badge>,
    },
    {
      key: "actions",
      label: "",
      render: (row) => {
        const next = ALERT_NEXT_STATUS[row.status];
        if (!next) return null;
        const isRecipient = row.recipientId?.id === user?.id;
        if (!canManage && !isRecipient) return null;
        return (
          <Button variant="ghost" onClick={() => openAlertAction(row)}>
            {t(`inventory.${ALERT_ACTION_LABEL_KEY[next]}`)}
          </Button>
        );
      },
    },
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

      <div className="inventory-filter-bar">
        <div className="inventory-filter-search">
          <InputField
            label={t("inventory.searchLedger")}
            placeholder={t("inventory.searchLedgerPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {activeTab !== "weapons" && (
          <>
            <InputField label={t("inventory.dateFrom")} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <InputField label={t("inventory.dateTo")} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </>
        )}
        {activeTab === "ledger" && (
          <InputField
            label={t("inventory.colType")}
            type="select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={[
              { value: "all", label: t("inventory.allTypes") },
              { value: "issue", label: t("inventory.typeIssue") },
              { value: "return", label: t("inventory.typeReturn") },
              { value: "damaged", label: t("inventory.typeDamaged") },
            ]}
          />
        )}
        {activeTab === "alerts" && (
          <>
            <InputField
              label={t("inventory.colPriority")}
              type="select"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              options={[
                { value: "all", label: t("inventory.allPriorities") },
                { value: "critical", label: t("inventory.priorityCritical") },
                { value: "warning", label: t("inventory.priorityWarning") },
                { value: "info", label: t("inventory.priorityInfo") },
              ]}
            />
            <InputField
              label={t("common.status")}
              type="select"
              value={alertStatusFilter}
              onChange={(e) => setAlertStatusFilter(e.target.value)}
              options={[
                { value: "all", label: t("inventory.allStatuses") },
                { value: "new", label: t("inventory.alertStatusNew") },
                { value: "acknowledged", label: t("inventory.alertStatusAcknowledged") },
                { value: "action_taken", label: t("inventory.alertStatusActionTaken") },
                { value: "resolved", label: t("inventory.alertStatusResolved") },
              ]}
            />
          </>
        )}
        {filtersActive && (
          <Button variant="ghost" type="button" onClick={clearFilters}>
            {t("inventory.clearFilters")}
          </Button>
        )}
      </div>

      <Card variant="panel">
        {activeTab === "weapons" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.equipmentLedgerTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.equipmentLedgerSubtitle")}</p>
            <Table columns={ledgerColumns} data={filteredItems} emptyMessage={t("inventory.noInventoryItems")} />
            <div className="inventory-footer-row">
              <span>{t("inventory.showingItems")} {filteredItems.length} / {stats?.totalAssets ?? items.length} {t("inventory.ofItemsRegistered")}</span>
            </div>
          </>
        )}

        {activeTab === "issue" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.issuingLogTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.issuingLogSubtitle")}</p>
            <Table columns={issueColumns} data={filteredIssueTx} emptyMessage={t("inventory.noItemsIssued")} />
          </>
        )}

        {activeTab === "return" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.returnedLogTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.returnedLogSubtitle")}</p>
            <Table columns={returnColumns} data={filteredReturnTx} emptyMessage={t("inventory.noReturnsRecorded")} />
          </>
        )}

        {activeTab === "ledger" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.auditLedgerTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.auditLedgerSubtitle")}</p>
            <Table columns={ledgerTxColumns} data={filteredLedgerTx} emptyMessage={t("inventory.noLedgerEntries")} />
            <div className="inventory-footer-row">
              <span>{t("inventory.showingItems")} {filteredLedgerTx.length} / {allTx.length} {t("inventory.ofEntriesTotal")}</span>
            </div>
          </>
        )}

        {activeTab === "maintenance" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.maintenanceTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.maintenanceSubtitle")}</p>
            <Table columns={maintenanceColumns} data={filteredMaintenanceRecords} emptyMessage={t("inventory.noMaintenanceRecords")} />
          </>
        )}

        {activeTab === "inspections" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.dueInspectionsTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.dueInspectionsSubtitle")}</p>
            <div className="inventory-inspection-stats">
              <span className="inventory-inspection-stat inventory-inspection-stat-danger">{overdueCount} {t("inventory.alertOverdue")}</span>
              <span className="inventory-inspection-stat inventory-inspection-stat-warning">{dueSoonCount} {t("inventory.alertDueSoon")}</span>
            </div>
            <Table columns={dueInspectionColumns} data={inspectableItems} emptyMessage={t("inventory.noInspectableItems")} />

            <h3 className="section-label">{t("inventory.inspectionHistoryTitle")}</h3>
            <Table columns={inspectionHistoryColumns} data={filteredInspectionRecords} emptyMessage={t("inventory.noInspectionRecords")} />
          </>
        )}

        {activeTab === "alerts" && (
          <>
            <p className="inventory-ledger-title">{t("inventory.alertsTitle")}</p>
            <p className="inventory-ledger-subtitle">{t("inventory.alertsSubtitle")}</p>
            <div className="inventory-inspection-stats">
              <span className="inventory-inspection-stat inventory-inspection-stat-danger">{criticalAlertsCount} {t("inventory.priorityCritical")}</span>
              <span className="inventory-inspection-stat inventory-inspection-stat-warning">{openAlertsCount} {t("inventory.openAlerts")}</span>
            </div>
            <Table columns={alertColumns} data={filteredAlerts} emptyMessage={t("inventory.noAlerts")} />
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
          <SearchableSelect
            label={t("inventory.officerId")}
            required
            value={issueForm.officer}
            onChange={(opt) => setIssueForm((f) => ({ ...f, officer: opt }))}
            searchFn={searchOfficersByRank}
            placeholder={t("leave.searchOfficerPlaceholder")}
          />
          <SearchableSelect
            label={t("inventory.weaponSerialId")}
            required
            value={issueForm.item}
            onChange={(opt) => setIssueForm((f) => ({ ...f, item: opt, quantity: "" }))}
            searchFn={searchIssuableItems}
            placeholder={t("inventory.weaponSerialId")}
          />
          <InputField
            label={t("inventory.quantityToIssue")}
            type="number"
            min="1"
            max={issueForm.item?.quantity}
            value={issueForm.quantity}
            onChange={(e) => setIssueForm((f) => ({ ...f, quantity: e.target.value }))}
            helperText={issueForm.item ? `${t("inventory.colQuantity")}: ${issueForm.item.quantity}` : undefined}
          />
          <InputField label={t("inventory.deploymentDate")} type="date" value={issueForm.deploymentDate} onChange={(e) => setIssueForm((f) => ({ ...f, deploymentDate: e.target.value }))} />
          <InputField
            label={t("inventory.expectedReturnDate")}
            type="date"
            value={issueForm.expectedReturnDate}
            onChange={(e) => setIssueForm((f) => ({ ...f, expectedReturnDate: e.target.value }))}
            helperText={t("inventory.expectedReturnDateHelper")}
          />
        </div>
        {modalError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{modalError}</p>}
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
          <SearchableSelect
            label={t("inventory.officerId")}
            required
            value={returnForm.officer}
            onChange={(opt) => setReturnForm((f) => ({ ...f, officer: opt, item: null }))}
            searchFn={searchOfficersByRank}
            placeholder={t("leave.searchOfficerPlaceholder")}
          />
          <SearchableSelect
            label={t("inventory.weaponSerialId")}
            required
            minChars={0}
            value={returnForm.item}
            onChange={(opt) => setReturnForm((f) => ({ ...f, item: opt }))}
            searchFn={searchOfficerIssuedItems}
            placeholder={returnForm.officer ? t("inventory.weaponSerialId") : t("inventory.selectOfficerFirst")}
          />
          <InputField
            label={t("inventory.quantityToReturn")}
            type="number"
            min="1"
            value={returnForm.quantity}
            onChange={(e) => setReturnForm((f) => ({ ...f, quantity: e.target.value }))}
          />
          <InputField label={t("inventory.returnDate")} type="date" value={returnForm.returnDate} onChange={(e) => setReturnForm((f) => ({ ...f, returnDate: e.target.value }))} />
          <InputField label={t("inventory.weaponCondition")} value={returnForm.condition} onChange={(e) => setReturnForm((f) => ({ ...f, condition: e.target.value }))} />
        </div>

        <h3 className="section-label">{t("inventory.ammoCheckTitle")}</h3>
        <div className="modal-form-grid">
          <InputField
            label={t("inventory.ammoIssued")}
            type="number"
            min="0"
            value={returnForm.ammoIssued}
            onChange={(e) => setReturnForm((f) => ({ ...f, ammoIssued: e.target.value }))}
          />
          <InputField
            label={t("inventory.ammoReturned")}
            type="number"
            min="0"
            value={returnForm.ammoReturned}
            onChange={(e) => setReturnForm((f) => ({ ...f, ammoReturned: e.target.value }))}
          />
          {returnForm.ammoIssued !== "" && returnForm.ammoReturned !== "" && (
            <InputField
              label={t("inventory.ammoUsed")}
              readOnly
              value={Number(returnForm.ammoIssued) - Number(returnForm.ammoReturned)}
            />
          )}
        </div>

        <p className="inventory-pending-note">{t("inventory.returnPendingNote")}</p>
        {modalError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{modalError}</p>}
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
          <InputField label={t("inventory.weaponSerialId")} value={addForm.weaponSerialId} onChange={(e) => setAddForm((f) => ({ ...f, weaponSerialId: e.target.value }))} />
          <InputField label={t("inventory.weaponType")} value={addForm.weaponType} onChange={(e) => setAddForm((f) => ({ ...f, weaponType: e.target.value }))} />
          <InputField
            label={t("inventory.colCategory")}
            type="select"
            required
            value={addForm.category}
            onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
            options={existingCategories.map((c) => ({ value: c, label: c }))}
          />
          <InputField label={t("inventory.quantityToAdd")} type="number" min="0" value={addForm.quantity} onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))} />
        </div>
        {modalError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{modalError}</p>}
      </Modal>

      <Modal
        open={Boolean(managingRecord)}
        onClose={closeMaintenance}
        title={managingRecord ? `${t("inventory.manageMaintenance")} — ${managingRecord.refId}` : ""}
        footer={
          managingRecord?.status !== "completed" && (
            <div style={{ display: "flex", gap: 12, width: "100%" }}>
              <Button variant="outline" fullWidth onClick={() => handleMaintenanceSave()} disabled={maintenanceSubmitting}>
                {t("inventory.saveDetails")}
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={() => handleMaintenanceSave(managingRecord?.status === "pending" ? "in_progress" : "completed")}
                disabled={maintenanceSubmitting}
              >
                {maintenanceSubmitting
                  ? t("inventory.processing")
                  : managingRecord?.status === "pending"
                  ? t("inventory.startMaintenance")
                  : t("inventory.completeMaintenance")}
              </Button>
            </div>
          )
        }
      >
        {managingRecord && maintenanceForm && (
          <>
            <div className="inventory-maintenance-summary">
              <p><strong>{t("inventory.colItemId")}:</strong> {managingRecord.itemId?.itemId || managingRecord.itemId?.itemName || "—"}</p>
              <p><strong>{t("inventory.colIssueDescription")}:</strong> {managingRecord.issueDescription}</p>
              <p><strong>{t("inventory.colReportedBy")}:</strong> {managingRecord.reportedBy?.fullName || managingRecord.reportedBy?.rankAndNumber || "—"}</p>
              <p><strong>{t("inventory.colReportedDate")}:</strong> {formatDate(managingRecord.reportedDate)}</p>
            </div>

            <div className="modal-form-grid">
              <InputField
                label={t("inventory.colAssignedTechnician")}
                value={maintenanceForm.assignedTechnician}
                readOnly={managingRecord.status === "completed"}
                onChange={(e) => setMaintenanceForm((f) => ({ ...f, assignedTechnician: e.target.value }))}
              />
              <InputField
                label={t("inventory.colMaintenanceType")}
                type="select"
                value={maintenanceForm.maintenanceType}
                onChange={(e) => setMaintenanceForm((f) => ({ ...f, maintenanceType: e.target.value }))}
                options={["Repair", "Inspection", "Cleaning", "Part Replacement", "Overhaul", "Other"].map((v) => ({ value: v, label: v }))}
              />
              <InputField
                label={t("inventory.partsCost")}
                value={maintenanceForm.partsCost}
                readOnly={managingRecord.status === "completed"}
                onChange={(e) => setMaintenanceForm((f) => ({ ...f, partsCost: e.target.value }))}
                placeholder={t("inventory.partsCostPlaceholder")}
              />
              <div className="field-full">
                <InputField
                  label={t("inventory.colRemarks")}
                  type="textarea"
                  rows={2}
                  value={maintenanceForm.remarks}
                  readOnly={managingRecord.status === "completed"}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, remarks: e.target.value }))}
                />
              </div>
            </div>

            {managingRecord.status === "in_progress" && (
              <>
                <h3 className="section-label">{t("inventory.finalInspectionTitle")}</h3>
                <div className="modal-form-grid">
                  <InputField
                    label={t("inventory.finalCondition")}
                    type="select"
                    value={maintenanceForm.finalCondition}
                    onChange={(e) => setMaintenanceForm((f) => ({ ...f, finalCondition: e.target.value }))}
                    options={[
                      { value: "good", label: t("status.good") },
                      { value: "damaged", label: t("status.damaged") },
                    ]}
                  />
                  <InputField
                    label={t("inventory.finalInspectionResult")}
                    type="select"
                    required
                    value={maintenanceForm.finalInspectionPassed}
                    onChange={(e) => setMaintenanceForm((f) => ({ ...f, finalInspectionPassed: e.target.value }))}
                    placeholder={t("inventory.selectResult")}
                    options={[
                      { value: "pass", label: t("inventory.inspectionPassed") },
                      { value: "fail", label: t("inventory.inspectionFailed") },
                    ]}
                  />
                </div>
                <p className="inventory-pending-note">{t("inventory.finalInspectionNote")}</p>
              </>
            )}

            {managingRecord.status === "completed" && (
              <div className="inventory-maintenance-summary">
                <p><strong>{t("inventory.finalCondition")}:</strong> {managingRecord.finalCondition ? <Badge status={managingRecord.finalCondition} /> : "—"}</p>
                <p><strong>{t("inventory.finalInspectionResult")}:</strong> {managingRecord.finalInspectionPassed ? t("inventory.inspectionPassed") : t("inventory.inspectionFailed")}</p>
                <p><strong>{t("inventory.colCompletionDate")}:</strong> {formatDate(managingRecord.completionDate)}</p>
              </div>
            )}
          </>
        )}
        {maintenanceError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{maintenanceError}</p>}
      </Modal>

      <Modal
        open={Boolean(inspectingItem)}
        onClose={closeInspect}
        title={inspectingItem ? `${t("inventory.inspectWeapon")} — ${inspectingItem.itemId}` : ""}
        footer={
          <Button variant="primary" fullWidth onClick={handleInspectionSubmit} disabled={inspectionSubmitting}>
            {inspectionSubmitting ? t("inventory.processing") : t("inventory.recordInspection")}
          </Button>
        }
      >
        {inspectingItem && inspectionForm && (
          <>
            <div className="inventory-maintenance-summary">
              <p><strong>{t("inventory.colItemId")}:</strong> {inspectingItem.itemId}</p>
              <p><strong>{t("inventory.colItemName")}:</strong> {inspectingItem.itemName}</p>
              <p><strong>{t("inventory.colLastInspection")}:</strong> {inspectingItem.lastInspectionDate ? formatDate(inspectingItem.lastInspectionDate) : "—"}</p>
            </div>

            <div className="modal-form-grid">
              <InputField
                label={t("inventory.colInspectionType")}
                type="select"
                value={inspectionForm.inspectionType}
                onChange={(e) => setInspectionForm((f) => ({ ...f, inspectionType: e.target.value }))}
                options={["Scheduled", "Random", "Post-Maintenance", "Other"].map((v) => ({ value: v, label: v }))}
              />
              <InputField
                label={t("inventory.colCondition")}
                type="select"
                value={inspectionForm.condition}
                onChange={(e) => setInspectionForm((f) => ({ ...f, condition: e.target.value }))}
                options={[
                  { value: "good", label: t("status.good") },
                  { value: "damaged", label: t("status.damaged") },
                ]}
              />
              <div className="field-full">
                <InputField
                  label={t("inventory.findings")}
                  type="textarea"
                  rows={2}
                  value={inspectionForm.findings}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, findings: e.target.value }))}
                  placeholder={t("inventory.findingsPlaceholder")}
                />
              </div>
              <div className="field-full">
                <InputField
                  label={t("inventory.damageIssues")}
                  type="textarea"
                  rows={2}
                  value={inspectionForm.damageIssues}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, damageIssues: e.target.value }))}
                  placeholder={t("inventory.damageIssuesPlaceholder")}
                />
              </div>
              <InputField
                label={t("inventory.accessoriesChecked")}
                value={inspectionForm.accessoriesChecked}
                onChange={(e) => setInspectionForm((f) => ({ ...f, accessoriesChecked: e.target.value }))}
                placeholder={t("inventory.accessoriesCheckedPlaceholder")}
              />
              <InputField
                label={t("inventory.colResult")}
                type="select"
                required
                value={inspectionForm.result}
                onChange={(e) => setInspectionForm((f) => ({ ...f, result: e.target.value }))}
                placeholder={t("inventory.selectResult")}
                options={[
                  { value: "passed", label: t("inventory.inspectionPassed") },
                  { value: "failed", label: t("inventory.inspectionFailed") },
                ]}
              />
              <div className="field-full">
                <InputField
                  label={t("inventory.colRemarks")}
                  type="textarea"
                  rows={2}
                  value={inspectionForm.remarks}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, remarks: e.target.value }))}
                />
              </div>
            </div>

            {inspectionForm.result === "failed" && (
              <p className="inventory-pending-note">{t("inventory.inspectionFailedNote")}</p>
            )}
          </>
        )}
        {inspectionError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{inspectionError}</p>}
      </Modal>

      <Modal
        open={Boolean(reportingMissingItem)}
        onClose={closeReportMissing}
        title={reportingMissingItem ? `${t("inventory.reportMissing")} — ${reportingMissingItem.itemId}` : ""}
        footer={
          <Button variant="primary" fullWidth onClick={handleReportMissingSubmit} disabled={missingSubmitting}>
            {missingSubmitting ? t("inventory.processing") : t("inventory.confirmReportMissing")}
          </Button>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 16 }}>
          {t("inventory.reportMissingText")}
        </p>
        <InputField
          label={t("inventory.colRemarks")}
          type="textarea"
          rows={3}
          value={missingRemarks}
          onChange={(e) => setMissingRemarks(e.target.value)}
          placeholder={t("inventory.reportMissingPlaceholder")}
        />
        {missingError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{missingError}</p>}
      </Modal>

      <Modal
        open={Boolean(actingAlert)}
        onClose={closeAlertAction}
        title={actingAlert ? `${actingAlert.title} — ${actingAlert.refId}` : ""}
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
                ? t("inventory.processing")
                : t(`inventory.${ALERT_ACTION_LABEL_KEY[ALERT_NEXT_STATUS[actingAlert.status]]}`)}
            </Button>
          )
        }
      >
        {actingAlert && (
          <div className="inventory-maintenance-summary">
            <p><strong>{t("inventory.colAlertTitle")}:</strong> {actingAlert.title}</p>
            {actingAlert.message && <p><strong>{t("inventory.colMessage")}:</strong> {actingAlert.message}</p>}
            <p><strong>{t("inventory.colItemId")}:</strong> {actingAlert.itemId?.itemId || actingAlert.itemId?.itemName || "—"}</p>
            <p><strong>{t("inventory.colGeneratedAt")}:</strong> {formatDateTime(actingAlert.generatedAt)}</p>
          </div>
        )}
        <InputField
          label={t("inventory.colRemarks")}
          type="textarea"
          rows={3}
          value={alertRemarks}
          onChange={(e) => setAlertRemarks(e.target.value)}
        />
        {alertError && <p style={{ color: "var(--color-danger)", marginTop: 12 }}>{alertError}</p>}
      </Modal>
    </div>
  );
}
