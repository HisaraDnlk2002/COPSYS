import { useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import "./AssignmentCell.css";

// Inline "assign an officer" control for a complaint row/cell — shows the
// assigned officer's name once set, otherwise a picker + Assign button.
// Shared by the OIC Dashboard's Incident Monitor and the Complaints
// Registry, since both let the OIC assign complaints to an officer.
export function AssignmentCell({ complaint, officers, onAssign }) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState("");
  const [assigning, setAssigning] = useState(false);

  const assignedOfficer = officers.find((o) => o.id === complaint.assignedOfficerId);
  if (assignedOfficer) return <span>{assignedOfficer.fullName}</span>;

  async function handleAssignClick() {
    if (!selected) return;
    setAssigning(true);
    try {
      await onAssign(complaint.id, selected);
    } catch (err) {
      console.error("Failed to assign complaint:", err);
      alert(err.message || t("assignment.errAssignFailed"));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="assignment-cell">
      <select
        className="assign-select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={assigning}
      >
        <option value="" disabled>{t("assignment.assignPlaceholder")}</option>
        {officers.map((o) => (
          <option key={o.id} value={o.id}>{o.fullName}</option>
        ))}
      </select>
      <button className="assign-btn" disabled={!selected || assigning} onClick={handleAssignClick}>
        {assigning ? t("assignment.assigning") : t("assignment.assign")}
      </button>
    </div>
  );
}
