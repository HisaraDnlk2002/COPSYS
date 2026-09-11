import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { convertOnWordBoundary, convertTrailingWord } from "../../utils/sinhalaTransliterate";
import "./InputField.css";

// Chrome/Edge only ship this under the webkit-prefixed name; Firefox/Safari
// don't implement it at all, hence the guarded lookup and the `voiceInput`
// button simply not rendering when neither constructor exists.
const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// Officers can dictate in either language — Web Speech API needs a BCP-47
// tag per recognition session (it doesn't auto-detect), so this is a
// deliberate choice made right before each recording, not a guess.
const VOICE_LANGUAGES = [
  { code: "en-US", label: "EN" },
  { code: "si-LK", label: "SI" },
];

// Mic toggle rendered inside a textarea/text field when `voiceInput` is on.
// The small EN/SI pair next to the mic picks which language the *next*
// recording uses — locked while actively listening, since switching mid-
// recording isn't meaningful. Starts on `defaultLang` (see InputField:
// whatever the app's own UI language currently is, unless a field
// explicitly overrides it), and an officer can always flip it per field
// regardless of that default. Dictated text is appended to whatever was
// already typed, not replacing it, so switching between typing and
// speaking mid-entry doesn't lose work.
function VoiceInputButton({ value, onChange, defaultLang }) {
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState(defaultLang);
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
    <div className="field-voice-controls">
      <div className="field-voice-lang-toggle">
        {VOICE_LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={`field-voice-lang-btn${lang === l.code ? " active" : ""}`}
            onClick={() => setLang(l.code)}
            disabled={listening}
            title={l.code === "si-LK" ? "Dictate in Sinhala" : "Dictate in English"}
          >
            {l.label}
          </button>
        ))}
      </div>
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
    </div>
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
  voiceLang, // optional — defaults to the app's current UI language (see resolvedVoiceLang below)
  sinhalaTyping = false, // opt-in per field — adds an "අ" toggle that phonetically transliterates Singlish as you type (e.g. "mama" -> "මම")
}) {
  const { language } = useLanguage();
  // Always starts off, regardless of the app's UI language — unlike
  // voice input (a deliberate press-to-talk action), this would silently
  // mangle ordinary English typing if it defaulted on (e.g. "Colombo"
  // contains valid Singlish syllables and would get transliterated).
  const [transliterateOn, setTransliterateOn] = useState(false);
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  const isTextlike = type === "textarea" || type === "text";
  const showSinhalaToggle = sinhalaTyping && !readOnly && isTextlike;
  const showVoiceButton = voiceInput && !readOnly && Boolean(SpeechRecognitionCtor) && isTextlike;
  const showTools = showSinhalaToggle || showVoiceButton;
  // A field can still force a specific starting language via `voiceLang`;
  // otherwise it starts matching whichever language the UI itself is in
  // right now (the officer can always flip it with the EN/SI toggle).
  const resolvedVoiceLang = voiceLang || (language === "si" ? "si-LK" : "en-US");

  function handleChange(e) {
    if (showSinhalaToggle && transliterateOn) {
      const converted = convertOnWordBoundary(e.target.value);
      if (converted !== e.target.value) {
        onChange({ target: { value: converted } });
        return;
      }
    }
    onChange(e);
  }

  // Commits whatever Latin word is left at the very end when the officer
  // tabs/clicks away without a trailing space or punctuation to trigger
  // the onChange-time conversion above.
  function handleBlur(e) {
    if (showSinhalaToggle && transliterateOn) {
      const converted = convertTrailingWord(e.target.value);
      if (converted !== e.target.value) {
        onChange({ target: { value: converted } });
      }
    }
  }

  return (
    <div className="field">
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label.toUpperCase()}
          {required && <span className="field-required"> *</span>}
        </label>
      )}

      <div className={showTools ? "field-with-tools" : undefined}>
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
            onChange={handleChange}
            onBlur={handleBlur}
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
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            required={required}
            min={min}
            max={max}
            readOnly={readOnly}
          />
        )}

        {showTools && (
          <div className="field-tool-controls">
            {showSinhalaToggle && (
              <button
                type="button"
                className={`field-sinhala-btn${transliterateOn ? " active" : ""}`}
                onClick={() => setTransliterateOn((v) => !v)}
                title={
                  transliterateOn
                    ? "Sinhala typing is on — click to type in English"
                    : 'Click to type in Sinhala — type phonetically, e.g. "mama" becomes "මම"'
                }
                aria-pressed={transliterateOn}
              >
                අ
              </button>
            )}
            {showVoiceButton && <VoiceInputButton value={value} onChange={onChange} defaultLang={resolvedVoiceLang} />}
          </div>
        )}
      </div>

      {error && <p className="field-error-text">{error}</p>}
      {!error && helperText && <p className="field-helper-text">{helperText}</p>}
    </div>
  );
}
