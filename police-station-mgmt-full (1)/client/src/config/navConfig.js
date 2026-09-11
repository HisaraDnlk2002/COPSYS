
export const navItemsByRole = {
  admin: [
    { key: "dashboard", label: "Dashboard", path: "/dashboard" },
    { key: "personnel", label: "Personnel & User Management", path: "/personnel" },
    { key: "leave", label: "Leave Requests", path: "/leave" },
    { key: "complaints", label: "Complaints registry", path: "/complaints" },
    { key: "reports", label: "Reports", path: "/reports" },
    { key: "audit-log", label: "Activity Log", path: "/audit-log" },
    { key: "settings", label: "Settings", path: "/settings" },
  ],
  oic: [
    { key: "dashboard", label: "Dashboard", path: "/dashboard" },
    { key: "duty-roster", label: "Duty Roster", path: "/duty-roster" },
    { key: "leave", label: "Leave Requests", path: "/leave" },
    { key: "complaints", label: "Complaints registry", path: "/complaints" },
    { key: "reports", label: "Reports", path: "/reports" },
    { key: "settings", label: "Settings", path: "/settings" },
  ],
  duty_officer: [
    { key: "dashboard", label: "Dashboard", path: "/dashboard" },
    { key: "duty-roster", label: "Duty Roster", path: "/duty-roster" },
    //{ key: "inventory", label: "Inventory", path: "/inventory" },
    { key: "weapon-management", label: "My Weapons", path: "/weapon-management" },
    { key: "leave", label: "Leave Requests", path: "/leave" },
    { key: "complaints", label: "Complaints registry", path: "/complaints" },
    { key: "reports", label: "Reports", path: "/reports" },
  ],
  inventory_officer: [
    { key: "dashboard", label: "Dashboard", path: "/dashboard" },
    { key: "inventory", label: "Inventory", path: "/inventory" },
    { key: "weapon-management", label: "My Weapons", path: "/weapon-management" },
    { key: "leave", label: "Leave Requests", path: "/leave" },
    { key: "complaints", label: "Complaints registry", path: "/complaints" },
    { key: "reports", label: "Reports", path: "/reports" },
  ],
  officer: [
    { key: "dashboard", label: "Dashboard", path: "/dashboard" },
    { key: "weapon-management", label: "My Weapons", path: "/weapon-management" },
    { key: "leave", label: "Leave Requests", path: "/leave" },
    { key: "complaints", label: "Complaints registry", path: "/complaints" },
  ],
};