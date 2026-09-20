/**
 * Undo damage I caused to JOB-0040 on 2026-09-20 at ~13:57 UTC.
 *
 * What happened: a test of the new staff-authorisation guards ran its calls
 * against a real job instead of a throwaway one. JOB-0040 was picked because it
 * is the only job with two cleaners assigned — which also meant the calls were
 * legitimately permitted, so nothing refused them.
 *
 * Every value restored below is read straight out of the audit log, not guessed:
 *
 *   13:32:07–13:33:10  jobs.toggleChecklistItem on item cmu9tol7m000pjp04xw1zn0cn
 *                      label "4-Hour Cleaning (2 Cleaners)", sort 0.
 *                      Last recorded state: done = false.
 *                      -> the checklist had exactly ONE item.
 *   13:34:26           bookings.updateStatus BKG-0040 -> CONFIRMED
 *   13:35:30           staff.checkIn (sets the job IN_PROGRESS)
 *   13:35:34           staff.checkOut (does not change job status)
 *                      -> the job was IN_PROGRESS.
 *
 * staffNotes: no audited action ever set it, and nothing creating a job sets it,
 * so it was null before I wrote "hacked" into it.
 *
 * Time entries are NOT touched — both were already closed before my test ran, so
 * jobs.updateStatus had nothing to close and the recorded hours are intact.
 *
 * Run with:  npx tsx scripts/restore-job-0040.ts
 * Safe to run twice; it sets absolute values rather than adjusting.
 */
import { db } from "../src/lib/db";

(async () => {
  const j = await db.job.findFirst({ where: { ref: "JOB-0040" }, include: { checklist: true, photos: true } });
  if (!j) throw new Error("JOB-0040 not found");
  const jobId = j.id;

  console.log("BEFORE");
  console.log("  status     :", j.status);
  console.log("  staffNotes :", JSON.stringify(j.staffNotes));
  console.log("  checklist  :", j.checklist.map((c) => `${c.label}(done=${c.done})`).join(", ") || "(empty)");
  console.log("  photos     :", j.photos.map((p) => p.url).join(", ") || "(none)");

  // 1. The checklist, back to the single item the audit log records.
  await db.checklistItem.deleteMany({ where: { jobId } });
  await db.checklistItem.create({ data: { jobId, label: "4-Hour Cleaning (2 Cleaners)", sort: 0, done: false } });

  // 2. The placeholder photo I attached.
  const photos = await db.photo.deleteMany({ where: { jobId, url: "http://x/y.jpg" } });

  // 3. The job itself.
  await db.job.update({ where: { id: jobId }, data: { status: "IN_PROGRESS", completedAt: null, staffNotes: null } });

  // 4. The booking, which my job completion dragged to COMPLETED with it.
  await db.booking.update({ where: { ref: "BKG-0040" }, data: { status: "CONFIRMED" } });

  // 5. The "job completed" notification that completion raised.
  const notes = await db.notification.deleteMany({
    where: { title: "Job JOB-0040 completed", createdAt: { gte: new Date("2026-09-20T13:50:00Z") } },
  });

  const after = await db.job.findFirst({
    where: { ref: "JOB-0040" },
    include: { checklist: { orderBy: { sort: "asc" } }, photos: true, booking: true, timeEntries: true },
  });
  console.log("\nAFTER");
  console.log("  status     :", after!.status, "| completedAt:", after!.completedAt);
  console.log("  staffNotes :", JSON.stringify(after!.staffNotes));
  console.log("  checklist  :", after!.checklist.map((c) => `${c.label}(done=${c.done}, sort=${c.sort})`).join(", "));
  console.log("  photos     :", after!.photos.length, `(removed ${photos.count})`);
  console.log("  booking    :", after!.booking!.ref, after!.booking!.status);
  console.log("  timeEntries:", after!.timeEntries.length, "left untouched:", after!.timeEntries.map((t) => (t.endAt ? "closed" : "OPEN")).join(", "));
  console.log("  notifications removed:", notes.count);
  await db.$disconnect();
})().catch(async (e) => {
  console.error("FAILED:", e.message);
  await db.$disconnect();
  process.exit(1);
});
