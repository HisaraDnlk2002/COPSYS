import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../i18n/useLanguage";
import { Button, StatCard, Card, Badge, Loader } from "../../components";
import { getBriefing } from "../../services/dutyRoster";
import { getAllLeaveRequests } from "../../services/leave";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function branchLabel(value) {
  return value ? value.split(" (")[0] : "";
}

function capacityTone(pct) {
  if (pct >= 100) return "#16a34a";
  if (pct >= 80) return "#d97706";
  return "#dc2626";
}

function overlapsToday(leave) {
  const today = new Date().setHours(0, 0, 0, 0);
  const start = new Date(leave.startDate).setHours(0, 0, 0, 0);
  const end = new Date(leave.endDate).setHours(0, 0, 0, 0);
  return today >= start && today <= end;
}

export function DutyOfficerBriefingPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [sidebarTab, setSidebarTab] = useState("leave"); // "leave" | "alerts"

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBriefing(todayIso()), getAllLeaveRequests()])
      .then(([briefingRes, leaveRes]) => {
        if (cancelled) return;
        setBriefing(briefingRes);
        setLeaveRequests(leaveRes.filter((l) => l.status === "approved" && overlapsToday(l)));
      })
      .catch((err) => console.error("Failed to load briefing:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loader label={t("briefing.loading")} />;

  const todayLabel = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  return (
    <div>
      <div className="dashboard-header">
        <div>
          <h1>{t("briefing.title")}</h1>
          <p style={{ color: "var(--color-text-muted)", margin: "4px 0 0" }}>
            {t("briefing.subtitle")} {todayLabel}
          </p>
        </div>
                <div className="dashboard-header-actions">
          <Button variant="primary" onClick={() => navigate("/duty-roster", { state: { openWizard: true } })}>
            {t("briefing.createNewRoster")}
          </Button>
          <Button variant="outline" onClick={() => navigate("/duty-roster", { state: { tab: "daily" } })}>
            {t("briefing.updateDailyAttendance")}
          </Button>
          <Button variant="outline" onClick={() => navigate("/leave")}>
            {t("briefing.manageLeave")}
          </Button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div className="stat-grid">
            <StatCard label={t("briefing.totalOfficers")} value={briefing.totalOfficers} />
            <StatCard label={t("briefing.presentActive")} value={briefing.present} />
            <StatCard label={t("briefing.onLeaveAbsent")} value={briefing.absent} />
            <StatCard label={t("briefing.currentShortage")} value={briefing.shortage} />
          </div>

          <Card variant="panel" style={{ marginTop: 24 }}>
            <div className="panel-header">
              <h3>{t("briefing.branchStaffingOverview")}</h3>
              <a className="panel-view-all" href="#" onClick={(e) => { e.preventDefault(); navigate("/duty-roster"); }}>
                {t("briefing.viewDetails")}
              </a>
            </div>

            {briefing.branchOverview.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)" }}>{t("briefing.noBranchData")}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {briefing.branchOverview.map((row) => (
                  <div key={row.branch} style={{ padding: 12, border: "1px solid var(--color-border, #e5e7eb)", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <strong>{branchLabel(row.branch)}</strong>
                      <span>{row.assigned}/{row.required}</span>
                    </div>
                    <div style={{ height: 6, background: "var(--color-border, #e5e7eb)", borderRadius: 3, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, row.capacityPct)}%`,
                          background: capacityTone(row.capacityPct),
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                      {row.capacityPct}% {t("briefing.capacity")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card variant="panel" style={{ marginTop: 24 }}>
            <div className="panel-header">
              <h3>{t("briefing.recentAlerts")}</h3>
            </div>
            {briefing.recentAlerts.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)" }}>{t("briefing.noRecentAlerts")}</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {briefing.recentAlerts.map((a) => (
                  <li key={a.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border, #e5e7eb)" }}>
                    <div style={{ fontWeight: 600 }}>
                      {a.officerId?.fullName} {t("briefing.calledInAbsent")}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{a.reason}</div>
                    {a.replacementOfficerId?.fullName && (
                      <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                        {t("briefing.coveredBy")} {a.replacementOfficerId.fullName}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card variant="panel" style={{ width: 300, flexShrink: 0 }}>
          <h3 style={{ marginTop: 0 }}>{t("briefing.dutyAlertsInfo")}</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              onClick={() => setSidebarTab("leave")}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--color-border, #e5e7eb)",
                background: sidebarTab === "leave" ? "var(--color-primary, #1d4ed8)" : "transparent",
                color: sidebarTab === "leave" ? "#fff" : "inherit",
                cursor: "pointer",
              }}
            >
              {t("briefing.officersOnLeave")}
            </button>
            <button
              onClick={() => setSidebarTab("alerts")}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--color-border, #e5e7eb)",
                background: sidebarTab === "alerts" ? "var(--color-primary, #1d4ed8)" : "transparent",
                color: sidebarTab === "alerts" ? "#fff" : "inherit",
                cursor: "pointer",
              }}
            >
              {t("briefing.staffingAlerts")}
            </button>
          </div>

          {sidebarTab === "leave" ? (
            leaveRequests.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{t("briefing.noOneOnLeaveToday")}</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {leaveRequests.map((l) => (
                  <li key={l.id} style={{ marginBottom: 12, fontSize: 13 }}>
                    <div style={{ fontWeight: 600 }}>
                      {l.officerName} <Badge status="pending" label={l.leaveType} />
                    </div>
                    <div style={{ color: "var(--color-text-muted)" }}>
                      {branchLabel(l.department)} · {t("briefing.returns")} {new Date(l.endDate).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : briefing.branchOverview.filter((b) => b.capacityPct < 100).length === 0 ? (
            <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{t("briefing.noStaffingAlerts")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {briefing.branchOverview
                .filter((b) => b.capacityPct < 100)
                .map((b) => (
                  <li key={b.branch} style={{ marginBottom: 12, fontSize: 13 }}>
                    <Badge status="rejected" label={t("briefing.shortfall")} />
                    <div style={{ fontWeight: 600, marginTop: 4 }}>{branchLabel(b.branch)}</div>
                    <div style={{ color: "var(--color-text-muted)" }}>
                      {b.assigned}/{b.required} {t("briefing.covered")}
                    </div>
                  </li>
                ))}
            </ul>
          )}

          <Button variant="outline" style={{ width: "100%", marginTop: 16 }} onClick={() => navigate("/duty-roster")}>
            {t("briefing.viewFullRoster")}
          </Button>
        </Card>
      </div>
    </div>
  );
}