import { db as live } from "./db";

/**
 * The expense category with this name, matched ignoring case and spacing, or a
 * new one. Matching exactly is how "Cleaning products" came to sit beside
 * "Cleaning Products": one typed name, two categories, split totals.
 */
export async function categoryIdFor(name: string | null | undefined, client: any = live): Promise<string | undefined> {
  const want = name?.trim();
  if (!want) return undefined;
  const all: { id: string; name: string }[] = await client.expenseCategory.findMany({ select: { id: true, name: true } });
  const found = all.find((c) => c.name.trim().toLowerCase() === want.toLowerCase());
  return found?.id ?? (await client.expenseCategory.create({ data: { name: want } })).id;
}
