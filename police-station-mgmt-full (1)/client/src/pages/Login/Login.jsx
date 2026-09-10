import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import { submitPasswordResetRequest } from "../../services/passwordResetRequests";
import policeLogo from "../../assets/Sri_Lanka_Police_logo.svg.png";
import "./Login.css";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();

  const [mode, setMode] = useState("login"); // "login" | "forgot"

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef(null);

  const [forgotRank, setForgotRank] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState("");

  function openForgotPassword() {
    setForgotRank(username);
    setForgotSent(false);
    setForgotError("");
    setMode("forgot");
  }

  function backToLogin() {
    setMode("login");
    setForgotSent(false);
    setForgotError("");
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();
    if (!forgotRank.trim()) {
      setForgotError(t("login.fieldsRequired"));
      return;
    }
    setForgotError("");
    setForgotSubmitting(true);
    try {
      // Always resolves the same way whether or not that account exists
      // — see submitPasswordResetRequest's comment — so this never
      // branches on "found" vs "not found".
      await submitPasswordResetRequest(forgotRank.trim());
      setForgotSent(true);
    } catch (err) {
      setForgotError(err.message || t("login.forgotPasswordFailed"));
    } finally {
      setForgotSubmitting(false);
    }
  }

  function checkCapsLock(e) {
    // getModifierState isn't implemented on every browser/input event —
    // guard it so a missing implementation just skips the hint instead
    // of throwing.
    if (typeof e.getModifierState === "function") {
      setCapsLockOn(e.getModifierState("CapsLock"));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setError(t("login.fieldsRequired"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await login(trimmedUsername, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Login failed");
      // Re-focus so a keyboard/screen-reader user lands straight back on
      // the field instead of having to tab back up to retry.
      usernameRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  const languageToggle = (
    <div className="login-language-toggle">
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
  );

  if (mode === "forgot") {
    return (
      <div className="login-page">
        {languageToggle}
        <div className="login-card">
          <div className="login-logo-ring">
            <img src={policeLogo} alt="Sri Lanka Police" className="login-logo" />
          </div>
          <h1 className="login-title">{t("login.forgotPasswordTitle")}</h1>

          {forgotSent ? (
            <>
              <p className="login-forgot-success">{t("login.forgotPasswordSuccess")}</p>
              <button type="button" className="login-button" onClick={backToLogin}>
                {t("login.forgotPasswordBackToLogin")}
              </button>
            </>
          ) : (
            <form onSubmit={handleForgotSubmit} noValidate>
              <p className="login-subtitle">{t("login.forgotPasswordSubtitle")}</p>

              <div className="login-field">
                <label htmlFor="forgot-rank">{t("login.rankNumber")}</label>
                <div className="login-input-wrap">
                  <svg className="login-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <input
                    id="forgot-rank"
                    type="text"
                    placeholder={t("login.rankNumberPlaceholder")}
                    value={forgotRank}
                    onChange={(e) => setForgotRank(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </div>
              </div>

              {forgotError && (
                <p className="login-error" role="alert" aria-live="polite">
                  {forgotError}
                </p>
              )}

              <button className="login-button" type="submit" disabled={forgotSubmitting}>
                {forgotSubmitting && <span className="login-spinner" aria-hidden="true" />}
                {forgotSubmitting ? t("login.forgotPasswordSubmitting") : t("login.forgotPasswordSubmit")}
              </button>

              <button type="button" className="login-forgot-link" onClick={backToLogin}>
                {t("login.forgotPasswordBackToLogin")}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      {languageToggle}

      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-logo-ring">
          <img src={policeLogo} alt="Sri Lanka Police" className="login-logo" />
        </div>
        <h1 className="login-title">{t("login.title")}</h1>
        <p className="login-subtitle">{t("login.subtitle")}</p>

        <div className="login-field">
          <label htmlFor="username">{t("login.rankNumber")}</label>
          <div className="login-input-wrap">
            <svg className="login-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <input
              id="username"
              ref={usernameRef}
              type="text"
              placeholder={t("login.rankNumberPlaceholder")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
        </div>

        <div className="login-field">
          <label htmlFor="password">{t("login.password")}</label>
          <div className="login-input-wrap">
            <svg className="login-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder={t("login.password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={checkCapsLock}
              onKeyDown={checkCapsLock}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="login-toggle-visibility"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
              aria-pressed={showPassword}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-6 0-10-6-10-8a13.16 13.16 0 0 1 3.06-4.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6 0 10 6 10 8a13.4 13.4 0 0 1-1.67 2.68M14.12 14.12a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M1 1l22 22" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {capsLockOn && <p className="login-caps-warning">⚠ {t("login.capsLockWarning")}</p>}

          <button type="button" className="login-forgot-link" onClick={openForgotPassword}>
            {t("login.forgotPasswordLink")}
          </button>
        </div>

        {error && (
          <p className="login-error" role="alert" aria-live="polite">
            {error}
          </p>
        )}

        <button className="login-button" type="submit" disabled={submitting}>
          {submitting && <span className="login-spinner" aria-hidden="true" />}
          {submitting ? t("login.loggingIn") : t("login.loginButton")}
        </button>

        <p className="login-footer-note">{t("login.footerNote")}</p>
      </form>
    </div>
  );
}
