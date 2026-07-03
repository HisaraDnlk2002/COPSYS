import "./Button.css";

// variant: "primary" (filled blue, e.g. "Register complaint"),
//          "outline" (blue border/text, e.g. "Apply Leave"),
//          "ghost" (no border, e.g. "Discard Draft")
// Matches the button styles seen across your dashboard and form mockups.
export function Button({
  children,
  variant = "primary",
  icon = null,
  type = "button",
  disabled = false,
  onClick,
  fullWidth = false,
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${fullWidth ? " btn-full" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="btn-icon">{icon}</span>}
      {children}
    </button>
  );
}
