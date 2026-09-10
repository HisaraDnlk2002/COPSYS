import { useEffect, useRef, useState } from "react";
import "./InputField.css";

// Chrome/Edge only ship this under the webkit-prefixed name; Firefox/Safari
// don't implement it at all, hence the guarded lookup and the `voiceInput`
// button simply not rendering when neither constructor exists.
const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// Mic toggle rendered inside a textarea/text field when `voiceInput` is on.
// Dictated text is appended to whatever was already typed, not replacing
// it, so switching between typing and speaking mid-entry doesn't lose work.
function VoiceInputButton({ value, onChange, lang }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const baseValueRef = useRef("");

  // Stop any in-progress recognition if the field unmounts mid-dictation
  // (e.g. the user navigates away or clears the form).
  useEffect(() => () => recognitionRef.current?.stop(), []);

  function toggle() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    baseValueRef.current = value || "";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += `${transcript} `;
        else interimText += transcript;
      }
      const dictated = (finalText + interimText).trim();
      const combined = [baseValueRef.current.trim(), dictated].filter(Boolean).join(" ");
      onChange({ target: { value: combined } });
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  return (
    <button
      type="button"
      className={`field-voice-btn${listening ? " field-voice-btn-active" : ""}`}
      onClick={toggle}
      title={listening ? "Stop dictation" : "Dictate with your microphone"}
      aria-pressed={listening}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
        <path d="M19 11a7 7 0 0 1-14 0" strokeLinecap="round" />
        <path d="M12 18v3" strokeLinecap="round" />
      </svg>
    </button>
  );
}

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
  min,
  max,
  readOnly = false,
  voiceInput = false,
  voiceLang = "en-US",
}) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  const showVoiceButton = voiceInput && !readOnly && Boolean(SpeechRecognitionCtor) && (type === "textarea" || type === "text");

  return (
    <div className="field">
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label.toUpperCase()}
          {required && <span className="field-required"> *</span>}
        </label>
      )}

      <div className={showVoiceButton ? "field-with-voice" : undefined}>
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
            readOnly={readOnly}
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
            min={min}
            max={max}
            readOnly={readOnly}
          />
        )}

        {showVoiceButton && <VoiceInputButton value={value} onChange={onChange} lang={voiceLang} />}
      </div>

      {error && <p className="field-error-text">{error}</p>}
      {!error && helperText && <p className="field-helper-text">{helperText}</p>}
    </div>
  );
}
