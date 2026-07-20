import { useEffect, useState } from "react";
import { LanguageContext } from "./languageContextObject";
import { translations } from "./translations";

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => localStorage.getItem("language") || "en");

  useEffect(() => {
    localStorage.setItem("language", language);
  }, [language]);

  function t(path) {
    const value = path.split(".").reduce((node, key) => node?.[key], translations[language]);
    return value ?? path;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
