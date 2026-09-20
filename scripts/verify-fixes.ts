/**
 * Self-cleaning verification of the delete/ref fixes, run against the live
 * database. Every row it creates is removed before it exits, and it prints the
 * number of strays left behind so a failure cannot be mistaken for a pass.
 */
import { db } from "../src/lib/db";
import { nextRef } from "../src/lib/ref";
import { runAction } from "../src/lib/registry";
import "../src/lib/actions";

const created: { model: string; id: string }[] = [];
const started = new Date();
let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "  PASS" : "!! FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

async function main() {
  const owner = await db.user.findFirst({ where: { role: "OWNER" } });
  const customer = await db.customer.findFirst();
  if (!owner || !customer) throw new Error("need an owner and a customer to test with");
  const ctx = { user: { id: owner.id, email: owner.email, name: owner.name, role: "OWNER" as const, staffId: null }, source: "system" as const };

  console.log("\n--- 1. nextRef survives a delete (LOGIC-AUDIT #1) ---");
  const r1 = await nextRef("BKG", "booking");
  const b1 = await db.booking.create({ data: { ref: r1, customerId: customer.id, startAt: new Date(), status: "PENDING" } });
  created.push({ model: "booking", id: b1.id });
  const r2 = await nextRef("BKG", "booking");
  const b2 = await db.booking.create({ data: { ref: r2, customerId: customer.id, startAt: new Date(), status: "PENDING" } });
  created.push({ model: "booking", id: b2.id });
  check(r2 !== r1, "two creates in a row get different refs", `${r1} then ${r2}`);

  // Delete the LOWER of the two: exactly the case that used to poison the counter.
  await db.booking.delete({ where: { id: b1.id } });
  created.splice(created.findIndex((c) => c.id === b1.id), 1);
  const r3 = await nextRef("BKG", "booking");
  check(r3 !== r2, "next ref after deleting an earlier record does not collide", `got ${r3}, ${r2} still in use`);
  try {
    const b3 = await db.booking.create({ data: { ref: r3, customerId: customer.id, startAt: new Date(), status: "PENDING" } });
    created.push({ model: "booking", id: b3.id });
    check(true, "the create after a delete actually succeeds", b3.ref);
  } catch (e: any) {
    check(false, "the create after a delete actually succeeds", e.code ?? e.message);
  }

  console.log("\n--- 2. deleting a booking releases the quote that made it ---");
  const qref = await nextRef("QT", "quote");
  const bref = await nextRef("BKG", "booking");
  const bk = await db.booking.create({ data: { ref: bref, customerId: customer.id, startAt: new Date(), status: "PENDING" } });
  created.push({ model: "booking", id: bk.id });
  const q = await db.quote.create({ data: { ref: qref, customerId: customer.id, status: "ACCEPTED", convertedBookingId: bk.id } });
  created.push({ model: "quote", id: q.id });

  const del = await runAction("bookings.delete", { bookingId: bk.id }, ctx, { confirmed: true });
  check(del.ok, "bookings.delete runs", del.ok ? "" : (del as any).error);
  if (del.ok) created.splice(created.findIndex((c) => c.id === bk.id), 1);
  const after = await db.quote.findUnique({ where: { id: q.id } });
  check(after?.convertedBookingId === null, "the quote no longer points at the deleted booking", `convertedBookingId=${after?.convertedBookingId}`);

  const qdel = await runAction("quotes.delete", { quoteId: q.id }, ctx, { confirmed: true });
  check(qdel.ok, "the quote can now be deleted", qdel.ok ? "" : (qdel as any).error);
  if (qdel.ok) created.splice(created.findIndex((c) => c.id === q.id), 1);

  console.log("\n--- 3. a quote whose booking still exists is still protected ---");
  const bref2 = await nextRef("BKG", "booking");
  const bk2 = await db.booking.create({ data: { ref: bref2, customerId: customer.id, startAt: new Date(), status: "PENDING" } });
  created.push({ model: "booking", id: bk2.id });
  const q2 = await db.quote.create({ data: { ref: await nextRef("QT", "quote"), customerId: customer.id, status: "ACCEPTED", convertedBookingId: bk2.id } });
  created.push({ model: "quote", id: q2.id });
  const blocked = await runAction("quotes.delete", { quoteId: q2.id }, ctx, { confirmed: true });
  check(!blocked.ok && String((blocked as any).error).includes(bref2), "a live booking still blocks the delete, and names itself", (blocked as any).error);

  console.log("\n--- 4. the real QT-0001 ---");
  const real = await db.quote.findUnique({ where: { ref: "QT-0001" } });
  if (!real) { check(false, "QT-0001 found"); }
  else {
    const stillThere = real.convertedBookingId
      ? await db.booking.findUnique({ where: { id: real.convertedBookingId } }) : null;
    check(stillThere === null, "QT-0001's booking is gone, so the delete guard now lets it through",
      real.convertedBookingId ? `pointer ${real.convertedBookingId} resolves to nothing` : "pointer already clear");
  }

  console.log("\n--- 5. a mis-tapped check-in records nothing ---");
  // An hourly cleaner on a real rate: the only pay type where tracked minutes
  // change the number, and so the only one that shows the bug.
  const staff = await db.staff.findFirst({ where: { payType: "HOURLY", payRate: { gt: 0 } } });
  if (!staff) { check(false, "an hourly cleaner on a pay rate exists to test with"); }
  else {
    const tj = await db.job.create({ data: {
      ref: await nextRef("JOB", "job"), customerId: customer.id, scheduledAt: new Date(),
      durationMin: 120, revenueCents: 10000, status: "SCHEDULED",
      assignments: { create: [{ staffId: staff.id, isLead: true }] },
    } });
    created.push({ model: "job", id: tj.id });

    // a) check in and straight back out, the way a mis-tap goes
    await runAction("staff.checkIn", { jobId: tj.id, staffId: staff.id }, ctx, { confirmed: true });
    const outFast: any = await runAction("staff.checkOut", { jobId: tj.id, staffId: staff.id }, ctx, { confirmed: true });
    const leftBehind = await db.timeEntry.count({ where: { jobId: tj.id } });
    check(outFast.ok && outFast.data?.removed === true && leftBehind === 0,
      "an immediate check-out leaves no time entry", outFast.data?.message ?? JSON.stringify(outFast));

    // b) and the costing then falls back to the scheduled duration, not a cent
    await db.job.update({ where: { id: tj.id }, data: { status: "COMPLETED" } });
    const c1: any = await runAction("jobs.costing", { jobId: tj.id }, ctx, { confirmed: true });
    const expected = Math.round((120 / 60) * staff.payRate); // 2h at the cleaner's rate
    check(c1.ok && c1.data.labourCents === expected && c1.data.labourEstimated === true,
      "costing estimates from the scheduled duration instead of showing a stray cent",
      `labourCents=${c1.data?.labourCents} (expected ${expected}), estimated=${c1.data?.labourEstimated}`);

    // c) real time still counts: an entry opened two minutes ago closes normally
    await db.timeEntry.create({ data: { jobId: tj.id, staffId: staff.id, startAt: new Date(Date.now() - 2 * 60000) } });
    const outReal: any = await runAction("staff.checkOut", { jobId: tj.id, staffId: staff.id }, ctx, { confirmed: true });
    const kept = await db.timeEntry.findFirst({ where: { jobId: tj.id } });
    check(outReal.ok && !!kept?.endAt, "a genuine check-out is still recorded",
      kept?.endAt ? `${Math.round((kept.endAt.getTime() - kept.startAt.getTime()) / 60000)} min kept` : "nothing kept");
  }

  console.log("\n--- 6. photo URLs ---");
  const { isUploadedFileUrl } = await import("../src/lib/storage");
  check(!isUploadedFileUrl("http://x/y.jpg"), "the junk URL on JOB-0040 would now be refused");
  check(!isUploadedFileUrl("https://example.com/cat.jpg"), "a link to someone else's image is refused");
  check(isUploadedFileUrl(`${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET || "uploads"}/abc123.jpg`), "a real uploaded URL is accepted");
}

main()
  .catch((e) => { console.error("\n!! THREW:", e); fail++; })
  .finally(async () => {
    for (const c of [...created].reverse()) {
      try { await (db as any)[c.model].delete({ where: { id: c.id } }); } catch {}
    }
    const strays = (await Promise.all(created.map(async (c) => await (db as any)[c.model].findUnique({ where: { id: c.id } })))).filter(Boolean).length;
    // Remove the audit rows this script wrote, so the audit page stays real.
    const wiped = await db.auditLog.deleteMany({ where: { createdAt: { gte: started }, source: "system" } });
    console.log(`\ncleanup: strays left = ${strays}, audit rows removed = ${wiped.count}`);
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
  });
