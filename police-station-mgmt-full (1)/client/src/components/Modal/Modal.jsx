import "./Modal.css";

// size: "default" (480px — forms, confirmations) | "wide" (near-full
// viewport — wide tables/grids that would otherwise be squeezed into a
// tiny horizontally-scrolling box inside the default width).
export function Modal({ open, onClose, title, children, footer, size = "default" }) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-content${size === "wide" ? " modal-content-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
