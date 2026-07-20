import { useContext } from "react";
import { LanguageContext } from "./languageContextObject";

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}
