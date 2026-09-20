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

/**
 * Free text a form can clear.
 *
 * `optionalText` treats blank as "I am not sending this field", which is right
 * for the assistant but wrong for an edit form: someone who empties the email
 * box means "remove it". Blank becomes null so Prisma actually writes it, and
 * the key is still omittable for callers that are not touching the field.
 *
 * Only for columns that are nullable in the schema.
 */
export const clearableText = () =>
  z.preprocess((v) => {
    if (v === null) return null;
    if (typeof v !== "string") return v ?? undefined;
    return v.trim() === "" ? null : v.trim();
  }, z.string().nullable().optional());
