"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, type Locale } from "@/lib/i18n";

const Ctx = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: (k: string) => string }>({
  locale: "en", setLocale: () => {}, t: (k) => k,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("bc_locale")) as Locale | null;
    if (saved === "en" || saved === "zh") setLocaleState(saved);
  }, []);
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem("bc_locale", l); } catch {}
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  };
  // Memoised: a fresh object here re-renders every component that calls t(),
  // which is very nearly all of them.
  const value = useMemo(() => ({ locale, setLocale, t: (k: string) => translate(locale, k) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

export function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium">
      {(["en", "zh"] as Locale[]).map((l) => (
        <button key={l} onClick={() => setLocale(l)}
          className={`rounded-md px-2.5 py-1 transition ${locale === l ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"}`}>
          {l === "en" ? "Eng" : "中文"}
        </button>
      ))}
    </div>
  );
}
