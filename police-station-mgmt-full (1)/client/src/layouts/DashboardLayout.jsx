import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useLanguage } from "../i18n/useLanguage";
import { navItemsByRole } from "../config/navConfig";
import policeLogo from "../assets/Sri_Lanka_Police_logo.svg.png";
import "./DashboardLayout.css";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navItems = navItemsByRole[user?.role] || [];
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
            >
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>
        <button className="logout-btn" onClick={logout}>
          {t("logout")}
        </button>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="topbar-brand-group">
            <button
              type="button"
              className="menu-toggle"
              aria-label="Toggle menu"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              ☰
            </button>
            <img src={policeLogo} alt="Sri Lanka Police" className="topbar-logo" />
            <span className="topbar-brand">{t("brand")}</span>
          </div>
          <div className="topbar-right">
            <div className="language-toggle">
              <button
                type="button"
                className={`language-btn${language === "en" ? " active" : ""}`}
                onClick={() => setLanguage("en")}
              >
                English
              </button>
              <button
                type="button"
                className={`language-btn${language === "si" ? " active" : ""}`}
                onClick={() => setLanguage("si")}
              >
                සිංහල
              </button>
            </div>
            <div className="topbar-user">
              <div>
                <div className="name">{user?.fullName}</div>
                <div className="role">{user?.role}</div>
              </div>
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
