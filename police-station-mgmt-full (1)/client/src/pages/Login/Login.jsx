import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import policeLogo from "../../assets/Sri_Lanka_Police_logo.svg.png";
import "./Login.css";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

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
        <h1 className="login-title">SRI LANKA POLICE</h1>
        <p className="login-subtitle">Airport Station Management System</p>

        <div className="login-field">
          <label htmlFor="username">Rank & Number</label>
          <input
            id="username"
            type="text"
            placeholder="e.g. 77412"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="login-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="login-error">{error}</p>}

        <button className="login-button" type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Login"}
        </button>
      </form>
    </div>
  );
}
