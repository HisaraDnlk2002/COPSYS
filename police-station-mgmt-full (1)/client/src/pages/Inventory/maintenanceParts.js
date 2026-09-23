// Helpers for the itemised maintenance parts list — kept out of
// MaintenancePartsEditor.jsx because a React component file should only
// export components (so hot-reload keeps working while editing).

export const EMPTY_PART = { name: "", quantity: "1", unitCost: "" };

export function formatLkr(amount) {
  return `LKR ${Number(amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Form rows hold strings (what inputs produce); this turns them into the
// numbers the server expects, dropping rows that were left completely
// blank. Returns { parts } or { errorRow } (1-based) for a half-filled row.
export function partsForSubmit(rows) {
  const parts = [];
  for (const [i, row] of rows.entries()) {
    const blank = !row.name.trim() && row.unitCost === "";
    if (blank) continue;
    const quantity = Number(row.quantity);
    const unitCost = Number(row.unitCost);
    if (!row.name.trim() || !Number.isInteger(quantity) || quantity < 1 || row.unitCost === "" || unitCost < 0) {
      return { errorRow: i + 1 };
    }
    parts.push({ name: row.name.trim(), quantity, unitCost });
  }
  return { parts };
}

export function lineTotal(row) {
  const q = Number(row.quantity);
  const c = Number(row.unitCost);
  return Number.isFinite(q) && Number.isFinite(c) ? q * c : 0;
}
