import { useLanguage } from "../../i18n/useLanguage";
import { Button } from "../Button/Button";
import "./Pagination.css";

// Shared prev/page-of-total/next bar — same shape Personnel.jsx and
// AuditLog.jsx each already hand-rolled (down to reusing the same
// "reports.prevPage"/"reports.pageOf"/"reports.nextPage" keys), pulled
// out here so Complaints/Inventory don't triplicate it a third and
// fourth time. Renders nothing when there's only one page.
export function Pagination({ page, totalPages, onPageChange }) {
  const { t } = useLanguage();
  if (totalPages <= 1) return null;

  return (
    <div className="pagination-bar">
      <Button variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        {t("reports.prevPage")}
      </Button>
      <span className="pagination-bar-label">
        {t("reports.pageOf").replace("{page}", page).replace("{total}", totalPages)}
      </span>
      <Button variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        {t("reports.nextPage")}
      </Button>
    </div>
  );
}
