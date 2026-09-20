import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { storage, storageConfigured, BUCKET } from "@/lib/storage";
import crypto from "crypto";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

/** Job photos and expense receipts, stored in Supabase Storage. */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  if (!storageConfigured()) {
    return NextResponse.json(
      { ok: false, error: "File storage is not configured on this server." },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: "File too large (max 8MB)" }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `${crypto.randomBytes(8).toString("hex")}.${ext}`;

  const { error } = await storage!.from(BUCKET).upload(name, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    console.error("upload failed", error);
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 502 });
  }

  const { data } = storage!.from(BUCKET).getPublicUrl(name);

  return NextResponse.json({ ok: true, url: data.publicUrl });
}
