import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../i18n/useLanguage";
import { globalSearch } from "../../services/search";
import "./GlobalSearch.css";

const EMPTY_RESULTS = { personnel: [], complaints: [], inventory: [], duty: [] };

// One combined "search everything" box across Personnel, Complaints,
// Inventory, and Duty Roster — those are the four separate registries
// that otherwise have no shared way to jump straight to a record.
// Every role sees this button; which categories actually return
// anything is decided server-side (searchController.js), matching each
// category's own page access exactly, so a result is never a dead click.
export function GlobalSearch() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Debounced fetch — waits for a short pause in typing rather than
  // firing on every keystroke.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      // Syncing displayed results to the query shrinking back below the
      // 2-character minimum — legitimate "prop changed, clear derived
      // state" case, not a cascading-render risk (query itself isn't
      // touched here).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      globalSearch(trimmed)
        .then((res) => setResults(res || EMPTY_RESULTS))
        .catch((err) => console.error("Global search failed:", err))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next) setTimeout(() => inputRef.current?.focus(), 0);
      return next;
    });
  }

  function closeAndReset() {
    setOpen(false);
    setQuery("");
    setResults(EMPTY_RESULTS);
  }

  // Each category hands off to its own page's existing search box (via
  // location.state), same "jump straight to it" pattern already used
  // elsewhere in this app (Dashboard's Apply Leave / Register Complaint
  // quick actions) — not a new deep-link mechanism per page.
  function goToPersonnel(item) {
    navigate("/personnel", { state: { searchTerm: item.fullName } });
    closeAndReset();
  }
  function goToComplaint(item) {
    navigate("/complaints", { state: { searchTerm: item.refId } });
    closeAndReset();
  }
  function goToInventory(item) {
    navigate("/inventory", { state: { searchTerm: item.itemId } });
    closeAndReset();
  }
  function goToDuty() {
    navigate("/duty-roster");
    closeAndReset();
  }

  function dutyStatusLabel(item) {
    if (item.status === "assigned") return item.department ? item.department.split(" (")[0] : t("search.onDuty");
    if (item.status === "on_leave") return t("status.on_leave");
    if (item.status === "absent") return t("status.absent");
    return t("status.general_duty");
  }

  const totalResults =
    results.personnel.length + results.complaints.length + results.inventory.length + results.duty.length;
  const trimmed = query.trim();

  return (
    <div className="global-search" ref={containerRef}>
      <button type="button" className="global-search-btn" onClick={toggleOpen} aria-label={t("search.title")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>

      {open && (
        <div className="global-search-dropdown">
          <input
            ref={inputRef}
            type="text"
            className="global-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
          />

          {trimmed.length > 0 && trimmed.length < 2 && (
            <p className="global-search-hint">{t("search.typeMore")}</p>
          )}

          {loading && <p className="global-search-hint">{t("search.searching")}</p>}

          {!loading && trimmed.length >= 2 && totalResults === 0 && (
            <p className="global-search-hint">{t("search.noResults")}</p>
          )}

          {!loading && results.personnel.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">{t("search.groupPersonnel")}</div>
              {results.personnel.map((p) => (
                <div key={p.id} className="global-search-result" onClick={() => goToPersonnel(p)}>
                  <span className="global-search-result-title">{p.fullName}</span>
                  <span className="global-search-result-meta">{p.rankAndNumber} · {p.rank || t("common.unassigned")}</span>
                </div>
              ))}
            </div>
          )}

          {!loading && results.complaints.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">{t("search.groupComplaints")}</div>
              {results.complaints.map((c) => (
                <div key={c.id} className="global-search-result" onClick={() => goToComplaint(c)}>
                  <span className="global-search-result-title">{c.refId} — {c.title}</span>
                  <span className="global-search-result-meta">{c.complainant?.fullName || ""}</span>
                </div>
              ))}
            </div>
          )}

          {!loading && results.inventory.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">{t("search.groupInventory")}</div>
              {results.inventory.map((i) => (
                <div key={i.id} className="global-search-result" onClick={() => goToInventory(i)}>
                  <span className="global-search-result-title">{i.itemId} — {i.itemName}</span>
                  <span className="global-search-result-meta">{i.category}</span>
                </div>
              ))}
            </div>
          )}

          {!loading && results.duty.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">{t("search.groupDuty")}</div>
              {results.duty.map((d) => (
                <div key={d.id} className="global-search-result" onClick={goToDuty}>
                  <span className="global-search-result-title">{d.fullName}</span>
                  <span className="global-search-result-meta">{dutyStatusLabel(d)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
