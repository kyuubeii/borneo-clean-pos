import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

/** Local disk storage under /public/uploads — no object store in v1. */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: "File too large (max 8MB)" }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ ok: true, url: `/uploads/${name}` });
}
