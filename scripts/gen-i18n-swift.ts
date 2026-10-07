/**
 * Writes ios/BorneoClean/Core/I18nDict.swift from src/lib/i18n.ts, so the
 * iPhone app says exactly what the web says. Run: npx tsx scripts/gen-i18n-swift.ts
 */
import { writeFileSync } from "node:fs";
import { dict } from "../src/lib/i18n";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const block = (name: string, m: Record<string, string>) =>
  `    static let ${name}: [String: String] = [\n${Object.entries(m).map(([k, v]) => `        "${esc(k)}": "${esc(v)}",`).join("\n")}\n    ]\n`;

writeFileSync("ios/BorneoClean/Core/I18nDict.swift",
  "// Generated from src/lib/i18n.ts -- do not edit by hand.\n" +
  "// Regenerate with `npx tsx scripts/gen-i18n-swift.ts` so the app says exactly what the web says.\n\n" +
  `enum I18nDict {\n${block("en", dict.en)}${block("zh", dict.zh as Record<string, string>)}}\n`);
