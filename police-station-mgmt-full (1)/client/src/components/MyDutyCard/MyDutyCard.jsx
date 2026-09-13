import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { getMySchedule } from "../../services/dutySchedule";
import { Card } from "../Card/Card";
import { Table } from "../Table/Table";
import { Badge } from "../Badge/Badge";
import { Loader } from "../Loader/Loader";

// "My duty this week" — every role gets this, not just the ones landing
// on the shared Dashboard page. GET /duty-schedule/mine is scoped to the
// caller's own uid server-side, and always returns one row per day of
// the current published week (a real shift, "On Leave", or the
// "General Duty" default), so this renders the same for an officer, an
// OIC, or a duty officer without any role-specific logic here.
export function MyDutyCard() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getMySchedule()
      .then((res) => {
        if (!cancelled) setSchedule(res || []);
      })
      .catch((err) => console.error("Failed to load duty schedule:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = [
    {
      key: "day",
      label: t("dashboard.colDay"),
      render: (row) => new Date(row.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    },
    {
      key: "shift",
      label: t("dashboard.colShiftTiming"),
      render: (row) => (row.shiftStart && row.shiftEnd ? `${row.shiftStart} - ${row.shiftEnd}` : "—"),
    },
    {
      key: "department",
      label: t("dashboard.colAssignDepartment"),
      render: (row) => row.department || "—",
    },
    {
      key: "status",
      label: t("common.status"),
      render: (row) => <Badge status={row.status} />,
    },
  ];

  return (
    <Card variant="panel">
      <div className="panel-header">
        <h3>{t("dashboard.weeklyDutySchedule")}</h3>
      </div>
      {loading ? <Loader label={t("dashboard.loading")} /> : <Table columns={columns} data={schedule} emptyMessage={t("dashboard.noShiftsScheduled")} />}
    </Card>
  );
}
