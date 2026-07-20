import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLanguage } from "../../i18n/useLanguage";
import policeLogo from "../../assets/Sri_Lanka_Police_logo.svg.png";
import "./Login.css";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src={policeLogo} alt="Sri Lanka Police" className="login-logo" />
        <h1 className="login-title">{t("login.title")}</h1>
        <p className="login-subtitle">{t("login.subtitle")}</p>

        <div className="login-field">
          <label htmlFor="username">{t("login.rankNumber")}</label>
          <input
            id="username"
            type="text"
            placeholder={t("login.rankNumberPlaceholder")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="login-field">
          <label htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            type="password"
            placeholder={t("login.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="login-error">{error}</p>}

        <button className="login-button" type="submit" disabled={submitting}>
          {submitting ? t("login.loggingIn") : t("login.loginButton")}
        </button>
      </form>
    </div>
  );
}
