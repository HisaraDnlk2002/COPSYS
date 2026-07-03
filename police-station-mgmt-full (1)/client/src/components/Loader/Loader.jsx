import "./Loader.css";

export function Loader({ label = "Loading…" }) {
  return (
    <div className="loader">
      <span className="loader-spinner" />
      <span className="loader-label">{label}</span>
    </div>
  );
}
