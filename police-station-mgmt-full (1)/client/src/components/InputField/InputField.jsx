import "./InputField.css";

// type: "text" | "password" | "select" | "date" | "textarea"
// For "select", pass options: [{ value, label }]
export function InputField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  options = [],
  required = false,
  error,
  helperText,
  rows = 4,
  id,
}) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="field">
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label.toUpperCase()}
          {required && <span className="field-required"> *</span>}
        </label>
      )}

      {type === "select" ? (
        <select
          id={inputId}
          className={`field-control${error ? " field-error" : ""}`}
          value={value}
          onChange={onChange}
          required={required}
        >
          <option value="" disabled>
            {placeholder || "Select…"}
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          id={inputId}
          className={`field-control${error ? " field-error" : ""}`}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={rows}
          required={required}
        />
      ) : (
        <input
          id={inputId}
          type={type}
          className={`field-control${error ? " field-error" : ""}`}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
        />
      )}

      {error && <p className="field-error-text">{error}</p>}
      {!error && helperText && <p className="field-helper-text">{helperText}</p>}
    </div>
  );
}
