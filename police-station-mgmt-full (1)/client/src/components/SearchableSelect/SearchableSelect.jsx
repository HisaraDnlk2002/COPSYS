import { useState, useRef, useEffect } from "react";
import "../InputField/InputField.css";
import "./SearchableSelect.css";

let debounceTimer;

// A text input that searches asynchronously as the user types and lets
// them pick one result from a dropdown, instead of free-typing a value.
//
// Props:
// - value: the currently selected option ({ value, label, ...extra }) or null
// - onChange(option | null): called when a selection is made or cleared
// - searchFn(query): async fn returning an array of { value, label, subtitle? }
export function SearchableSelect({
  label,
  required = false,
  value,
  onChange,
  searchFn,
  placeholder = "Search…",
  error,
  helperText,
  minChars = 1,
  id,
}) {
  const [query, setQuery] = useState(value?.label || "");
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef(null);
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  useEffect(() => {
    setQuery(value?.label || "");
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleInputChange(e) {
    const text = e.target.value;
    setQuery(text);
    setOpen(true);
    setHighlighted(-1);

    if (value && text !== value.label) {
      onChange(null);
    }

    clearTimeout(debounceTimer);
    if (text.trim().length < minChars) {
      setOptions([]);
      return;
    }

    debounceTimer = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchFn(text.trim());
        setOptions(results || []);
      } catch (err) {
        console.error("Officer search failed:", err);
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function selectOption(opt) {
    onChange(opt);
    setQuery(opt.label);
    setOptions([]);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0) selectOption(options[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDropdown = open && query.trim().length >= minChars;

  return (
    <div className="field searchable-select" ref={containerRef}>
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label.toUpperCase()}
          {required && <span className="field-required"> *</span>}
        </label>
      )}

      <div className="searchable-select-wrap">
        <input
          id={inputId}
          type="text"
          className={`field-control${error ? " field-error" : ""}`}
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
        />
        {loading && <span className="searchable-select-spinner" aria-hidden="true" />}

        {showDropdown && (
          <ul className="searchable-select-dropdown">
            {loading && options.length === 0 && (
              <li className="searchable-select-empty">Searching…</li>
            )}
            {!loading && options.length === 0 && (
              <li className="searchable-select-empty">No matches found</li>
            )}
            {options.map((opt, i) => (
              <li
                key={opt.value}
                className={`searchable-select-option${i === highlighted ? " is-highlighted" : ""}`}
                onMouseDown={() => selectOption(opt)}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="searchable-select-option-label">{opt.label}</span>
                {opt.subtitle && (
                  <span className="searchable-select-option-subtitle">{opt.subtitle}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="field-error-text">{error}</p>}
      {!error && helperText && <p className="field-helper-text">{helperText}</p>}
    </div>
  );
}
