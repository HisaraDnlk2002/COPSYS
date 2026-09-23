import { useLanguage } from "../../i18n/useLanguage";
import { Button } from "../../components";
import { EMPTY_PART, formatLkr, lineTotal } from "./maintenanceParts";

// Suggestions offered while typing a part name — any other name can
// still be typed. Not validated on the server; it's just a shortcut.
const COMMON_WEAPON_PARTS = [
  "Firing Pin",
  "Firing Pin Spring",
  "Recoil Spring",
  "Extractor",
  "Ejector",
  "Magazine",
  "Magazine Spring",
  "Trigger Assembly",
  "Hammer Spring",
  "Slide",
  "Barrel",
  "Front Sight",
  "Rear Sight",
  "Grip Panel",
  "Bolt",
  "Gas Piston",
  "Sling Swivel",
  "Battery Pack",
  "Holster",
];

// Itemised "parts used" list for the Manage Maintenance modal: one row
// per part (name, quantity, unit cost), with each row's total and a
// grand total worked out as you type. `rows` is controlled by the parent.
export function MaintenancePartsEditor({ rows, onChange, readOnly }) {
  const { t } = useLanguage();
  const grandTotal = rows.reduce((sum, row) => sum + lineTotal(row), 0);

  function updateRow(index, field, value) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function removeRow(index) {
    onChange(rows.filter((_, i) => i !== index));
  }

  if (readOnly && rows.length === 0) {
    return <p className="parts-empty">{t("inventory.noPartsRecorded")}</p>;
  }

  return (
    <div className="parts-editor">
      <div className="parts-row parts-row-head" aria-hidden="true">
        <span>{t("inventory.partName")}</span>
        <span>{t("inventory.partQty")}</span>
        <span>{t("inventory.partUnitCost")}</span>
        <span className="parts-num">{t("inventory.partLineTotal")}</span>
        <span />
      </div>

      {rows.map((row, i) => (
        <div className="parts-row" key={i}>
          <input
            className="field-control"
            list="common-weapon-parts"
            aria-label={t("inventory.partName")}
            placeholder={t("inventory.partNamePlaceholder")}
            value={row.name}
            readOnly={readOnly}
            onChange={(e) => updateRow(i, "name", e.target.value)}
          />
          <input
            className="field-control"
            type="number"
            min="1"
            step="1"
            aria-label={t("inventory.partQty")}
            value={row.quantity}
            readOnly={readOnly}
            onChange={(e) => updateRow(i, "quantity", e.target.value)}
          />
          <input
            className="field-control"
            type="number"
            min="0"
            step="0.01"
            aria-label={t("inventory.partUnitCost")}
            placeholder="0.00"
            value={row.unitCost}
            readOnly={readOnly}
            onChange={(e) => updateRow(i, "unitCost", e.target.value)}
          />
          <span className="parts-num parts-line-total">{formatLkr(lineTotal(row))}</span>
          {readOnly ? (
            <span />
          ) : (
            <button
              type="button"
              className="parts-remove"
              onClick={() => removeRow(i)}
              aria-label={t("inventory.removePart")}
              title={t("inventory.removePart")}
            >
              ×
            </button>
          )}
        </div>
      ))}

      <datalist id="common-weapon-parts">
        {COMMON_WEAPON_PARTS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <div className="parts-footer">
        {!readOnly && (
          <Button variant="outline" type="button" onClick={() => onChange([...rows, { ...EMPTY_PART }])}>
            + {t("inventory.addPart")}
          </Button>
        )}
        <span className="parts-grand-total">
          {t("inventory.totalCost")}: <strong>{formatLkr(grandTotal)}</strong>
        </span>
      </div>
    </div>
  );
}
