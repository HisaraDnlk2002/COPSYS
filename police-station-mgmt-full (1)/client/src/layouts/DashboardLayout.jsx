import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { navItemsByRole } from "../config/navConfig";
import policeLogo from "../assets/Sri_Lanka_Police_logo.svg.png";
import "./DashboardLayout.css";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navItems = navItemsByRole[user?.role] || [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="logout-btn" onClick={logout}>
          Logout
        </button>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="topbar-brand-group">
            <img src={policeLogo} alt="Sri Lanka Police" className="topbar-logo" />
            <span className="topbar-brand">Police Station Management System</span>
          </div>
          <div className="topbar-user">
            <div>
              <div className="name">{user?.fullName}</div>
              <div className="role">{user?.role}</div>
            </div>
          </div>
        </header>

        <div className="page-body">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
