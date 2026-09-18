import { z } from "zod";

/**
 * An optional record ID.
 *
 * Models routinely emit "", " " or "/" for an optional field they have no value
 * for. Passed through to Prisma those become foreign keys that match nothing, so
 * coerce anything blank to undefined before validation.
 */
export const optionalId = () =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v ?? undefined;
    const t = v.trim();
    return t === "" || t === "/" || t === "null" || t === "undefined" ? undefined : t;
  }, z.string().optional());

/** Same coercion, but the field may also be explicitly cleared with null. */
export const nullableId = () =>
  z.preprocess((v) => {
    if (v === null) return null;
    if (typeof v !== "string") return v ?? undefined;
    const t = v.trim();
    return t === "" || t === "/" || t === "null" ? null : t;
  }, z.string().nullable().optional());

/** Optional free text where a blank string means "not provided", not "clear it". */
export const optionalText = () =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v ?? undefined;
    return v.trim() === "" ? undefined : v;
  }, z.string().optional());
