import { useLanguage } from "../../i18n/useLanguage";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function dateForDayIndex(weekStarting, dayIndex) {
  const d = new Date(weekStarting);
  d.setDate(d.getDate() + dayIndex);
  return d;
}

function branchShort(value) {
  return value ? value.split(" (")[0] : "";
}

function officerOnLeaveThatDay(officerId, date, leaveRequests) {
  return leaveRequests.some((l) => {
    const oid = l.officerId || l.officer_id;
    if (oid !== officerId) return false;
    const day = new Date(date).setHours(0, 0, 0, 0);
    const start = new Date(l.startDate).setHours(0, 0, 0, 0);
    const end = new Date(l.endDate).setHours(0, 0, 0, 0);
    return day >= start && day <= end;
  });
}

const CELL_COLOR = {
  onDuty: "var(--color-success, #16a34a)",
  absent: "var(--color-danger, #dc2626)",
  leave: "var(--color-warning, #d97706)",
  general: "var(--color-info, #2563eb)",
};

// Read-only audit view for a completed (published) roster week: unlike
// WeeklyGrid — which is a branch-requirement grid that only ever shows
// officers who actually got a shift that week — this lists every active
// officer at the station, one row each, so anyone left unassigned is
// still visible instead of silently missing from the page.
export function RosterSummary({ week, shifts, officers, leaveRequests }) {
  const { t } = useLanguage();

  const activeOfficers = officers
    .filter((o) => o.status === "active")
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  if (activeOfficers.length === 0) {
    return <p style={{ color: "var(--color-text-muted)" }}>{t("dutyRoster.summary.noOfficers")}</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="roster-grid-table" style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ minWidth: 160, textAlign: "left" }}>{t("dutyRoster.summary.officer")}</th>
            <th style={{ minWidth: 130, textAlign: "left" }}>{t("dutyRoster.summary.department")}</th>
            {DAY_NAMES.map((day, i) => {
              const date = dateForDayIndex(week.weekStarting, i);
              return (
                <th key={day} style={{ minWidth: 90 }}>
                  {date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {activeOfficers.map((officer) => (
            <tr key={officer.id}>
              <td style={{ fontWeight: 600 }}>
                {officer.fullName}
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 400 }}>
                  {officer.rankAndNumber}
                </div>
              </td>
              <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{branchShort(officer.department)}</td>
              {DAY_NAMES.map((day, dayIndex) => {
                const date = dateForDayIndex(week.weekStarting, dayIndex);
                const dateKey = isoDate(date);
                const officerShifts = shifts.filter((s) => {
                  const oid = typeof s.officerId === "object" ? s.officerId.id || s.officerId._id : s.officerId;
                  return oid === officer.id && isoDate(s.date) === dateKey;
                });

                let cell;
                let colorKind;
                if (officerShifts.length > 0) {
                  colorKind = officerShifts.some((s) => s.status === "absent") ? "absent" : "onDuty";
                  cell = officerShifts
                    .map((s) =>
                      s.status === "absent"
                        ? t("dutyRoster.summary.absent")
                        : `${s.shiftType === "night" ? t("dutyRoster.summary.night") : t("dutyRoster.summary.day")} · ${branchShort(s.department)}`
                    )
                    .join(" + ");
                } else if (officerOnLeaveThatDay(officer.id, date, leaveRequests)) {
                  colorKind = "leave";
                  cell = t("dutyRoster.summary.onLeave");
                } else {
                  // No specific branch shift and not on leave — officers
                  // aren't idle days off here, they default to General
                  // Duty rather than reading as unaccounted-for.
                  colorKind = "general";
                  cell = t("dutyRoster.summary.generalDuty");
                }

                return (
                  <td
                    key={day}
                    style={{
                      fontSize: 11,
                      textAlign: "center",
                      color: CELL_COLOR[colorKind],
                      fontWeight: colorKind === "onDuty" || colorKind === "absent" ? 600 : 400,
                    }}
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
