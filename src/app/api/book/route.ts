import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nextRef } from "@/lib/ref";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";

/** Public booking request. Creates a PENDING booking for the office to confirm — never a confirmed job. */
export async function GET() {
  const services = await db.service.findMany({ where: { active: true }, orderBy: [{ isAddon: "asc" }, { name: "asc" }] });
  const name = await db.setting.findUnique({ where: { key: "business.name" } });
  const phone = await db.setting.findUnique({ where: { key: "business.phone" } });
  return NextResponse.json({ services, business: { name: name?.value ?? "Borneo Clean", phone: phone?.value ?? "" } });
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = String(b.name ?? "").trim();
  const phone = String(b.phone ?? "").trim();
  const serviceIds: string[] = Array.isArray(b.serviceIds) ? b.serviceIds.slice(0, 10) : [];
  if (!name || !phone || !serviceIds.length || !b.startAt) {
    return NextResponse.json({ ok: false, error: "Please complete every required field." }, { status: 400 });
  }
  const services = await db.service.findMany({ where: { id: { in: serviceIds }, active: true } });
  if (!services.length) return NextResponse.json({ ok: false, error: "Please choose a service." }, { status: 400 });

  // Reuse an existing customer when the phone matches, so requests do not create duplicates.
  let customer = await db.customer.findFirst({ where: { phone } });
  if (!customer) {
    customer = await db.customer.create({ data: {
      name, phone, email: b.email ? String(b.email).trim() : null,
      addresses: b.address ? { create: { label: "Home", line1: String(b.address).slice(0, 200), city: b.city ? String(b.city) : null, isPrimary: true } } : undefined,
    } });
  }
  const address = await db.address.findFirst({ where: { customerId: customer.id, isPrimary: true } });

  const booking = await db.booking.create({ data: {
    ref: await nextRef("BKG", "booking"), customerId: customer.id, addressId: address?.id,
    startAt: new Date(b.startAt), durationMin: services.reduce((a, s) => a + s.durationMin, 0) || 120,
    status: "PENDING", source: "ONLINE", notes: b.notes ? String(b.notes).slice(0, 500) : null,
    items: { create: services.map((s) => ({ serviceId: s.id, qty: 1, priceCents: s.priceCents, name: s.name })) },
  } });

  await notify({ type: "BOOKING_CONFIRMED", title: `Online booking request ${booking.ref}`,
    body: `${customer.name} · ${new Date(b.startAt).toLocaleString("en-MY")}`, link: `/bookings/${booking.id}` });
  await audit({ actorName: customer.name, action: "bookings.requestOnline", source: "system",
    entity: "Booking", entityId: booking.id, payload: { name, phone }, ok: true });

  return NextResponse.json({ ok: true, ref: booking.ref,
    total: services.reduce((a, s) => a + s.priceCents, 0) });
}
