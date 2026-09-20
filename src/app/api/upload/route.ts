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

/** What may be attached, and the extension each is stored under. */
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg", "image/pjpeg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf",
};

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
  if (file.size === 0) return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: "File too large (max 8MB)" }, { status: 400 });

  const type = (file.type || "").toLowerCase();

  // An iPhone shooting in High Efficiency sends HEIC. It uploads fine and then
  // shows as a broken thumbnail everywhere except Safari, which reads as a
  // corrupted photo. Say so instead of storing something nobody can open.
  if (type === "image/heic" || type === "image/heif" || /\.hei[cf]$/i.test(file.name)) {
    return NextResponse.json(
      { ok: false, error: "iPhone HEIC photos cannot be shown in the browser. On the phone: Settings → Camera → Formats → Most Compatible, then take the photo again." },
      { status: 415 },
    );
  }

  if (!ALLOWED[type]) {
    return NextResponse.json(
      { ok: false, error: "Only JPG, PNG, WebP, GIF or PDF files can be attached." },
      { status: 415 },
    );
  }

  // The extension comes from the content type, not the filename: a photo taken
  // in the browser arrives named "blob" with no extension at all, and a wrong
  // extension is what makes a perfectly good file look corrupt on the way back.
  const name = `${crypto.randomBytes(8).toString("hex")}.${ALLOWED[type]}`;

  // Buffered rather than streamed: the body is capped at 8MB just above, and a
  // buffer carries a known length, so a truncated upload fails here instead of
  // landing in the bucket as a half-written file.
  const body = Buffer.from(await file.arrayBuffer());
  if (body.byteLength !== file.size) {
    return NextResponse.json({ ok: false, error: "The upload was cut short. Try again." }, { status: 400 });
  }

  const { error } = await storage!.from(BUCKET).upload(name, body, {
    contentType: type,
    upsert: false,
  });
  if (error) {
    console.error("upload failed", error);
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 502 });
  }

  const { data } = storage!.from(BUCKET).getPublicUrl(name);

  return NextResponse.json({ ok: true, url: data.publicUrl });
}
