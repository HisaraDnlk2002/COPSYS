import { useEffect, useState } from "react";
import { loginRequest } from "../services/auth";
import { getMyProfile } from "../services/users";
import { AuthContext } from "./authContextObject";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // profile: fullName, role, department, etc.
  // Only start "loading" if there's a token to actually go verify —
  // otherwise there's nothing to wait for, so don't show a spinner.
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("token")));
  const [error, setError] = useState(null);

  // On app load, if a session is already stored, try to restore it
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    let cancelled = false;
    getMyProfile()
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("dummyUserId");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(username, password) {
    setError(null);
    const { token, user: loggedInUser } = await loginRequest(username, password);
    localStorage.setItem("token", token);
    // Only used by the dummy data layer to know "who am I" on refresh;
    // harmless to keep once real auth lands, but unused then.
    localStorage.setItem("dummyUserId", loggedInUser.id);
    setUser(loggedInUser);
    return loggedInUser;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("dummyUserId");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
