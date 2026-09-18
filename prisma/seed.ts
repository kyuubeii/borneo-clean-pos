import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();
const SECRET = process.env.SESSION_SECRET || "borneo-clean-dev-secret";
const hash = (p: string) => crypto.createHash("sha256").update(p + SECRET).digest("hex");

const day = 86400000;
const at = (daysFromNow: number, hour: number, min = 0) => {
  const d = new Date(); d.setDate(d.getDate() + daysFromNow); d.setHours(hour, min, 0, 0); return d;
};
const pick = <T,>(a: T[], i: number) => a[i % a.length];

async function main() {
  console.log("Clearing…");
  for (const m of ["auditLog","chatMessage","notification","payout","expense","expenseCategory","payment","invoiceItem","invoice","quoteItem","quote","timeEntry","photo","checklistItem","jobAssignment","job","bookingItem","booking","address","customer","availability","staff","user","service","setting"]) {
    await (db as any)[m].deleteMany();
  }

  console.log("Settings, users, staff…");
  await db.setting.createMany({ data: [
    { key: "business.name", value: "Borneo Clean Services" },
    { key: "business.email", value: "hello@borneoclean.my" },
    { key: "business.phone", value: "+60 12-345 6789" },
    { key: "business.address", value: "Lot 23, Jalan Padungan, 93100 Kuching, Sarawak" },
    { key: "business.regNo", value: "SSM 202301234567" },
    { key: "invoice.taxRateBp", value: "600" },
    { key: "invoice.dueDays", value: "14" },
    { key: "invoice.footer", value: "Thank you for your business. Payment to Maybank 5141 2233 4455." },
    { key: "ai.model", value: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5" },
    { key: "notify.bookingConfirmation", value: "true" },
    { key: "notify.reminders", value: "true" },
    { key: "notify.paymentReminders", value: "true" },
  ] });

  const owner = await db.user.create({ data: { email: "owner@borneoclean.my", name: "Siti Rahman", password: hash("owner123"), role: "OWNER" } });
  await db.user.create({ data: { email: "admin@borneoclean.my", name: "Daniel Lim", password: hash("admin123"), role: "ADMIN" } });

  const staffSeed = [
    { name: "Aisyah Binti Omar", phone: "012-388 1122", payType: "HOURLY", payRate: 1800, colour: "#3385fb" },
    { name: "Chong Wei Ming", phone: "013-455 7788", payType: "HOURLY", payRate: 2000, colour: "#16a34a" },
    { name: "Nurul Huda", phone: "014-622 3344", payType: "PER_JOB", payRate: 8000, colour: "#f59e0b" },
    { name: "Rajesh Kumar", phone: "016-712 9900", payType: "HOURLY", payRate: 1900, colour: "#a855f7" },
    { name: "Lim Mei Ling", phone: "017-899 5566", payType: "PERCENT", payRate: 3500, colour: "#ec4899" },
  ];
  const staff = [];
  for (const s of staffSeed) {
    const st = await db.staff.create({ data: { ...s, email: s.name.split(" ")[0].toLowerCase() + "@borneoclean.my" } });
    await db.availability.createMany({ data: [1,2,3,4,5,6].map((weekday) => ({ staffId: st.id, weekday, startMin: 8*60, endMin: 18*60 })) });
    staff.push(st);
  }
  const staffUser = await db.user.create({ data: { email: "aisyah@borneoclean.my", name: "Aisyah Binti Omar", password: hash("staff123"), role: "STAFF" } });
  await db.staff.update({ where: { id: staff[0].id }, data: { userId: staffUser.id } });

  console.log("Services…");
  const svcSeed = [
    { name: "Standard Home Cleaning", nameZh: "标准家居清洁", category: "Residential", priceCents: 15000, durationMin: 120, materialCostCents: 1500 },
    { name: "Deep Cleaning", nameZh: "深层清洁", category: "Residential", priceCents: 38000, durationMin: 300, materialCostCents: 4500 },
    { name: "Move-In / Move-Out Clean", nameZh: "搬迁清洁", category: "Residential", priceCents: 45000, durationMin: 360, materialCostCents: 6000 },
    { name: "Office Cleaning", nameZh: "办公室清洁", category: "Commercial", priceCents: 28000, durationMin: 180, materialCostCents: 2500 },
    { name: "Post-Renovation Clean", nameZh: "装修后清洁", category: "Specialty", priceCents: 62000, durationMin: 480, materialCostCents: 9000 },
    { name: "Carpet Shampoo", nameZh: "地毯清洗", category: "Specialty", priceCents: 18000, durationMin: 90, materialCostCents: 3500 },
    { name: "Window Cleaning (Interior)", nameZh: "室内窗户清洁", category: "Add-on", priceCents: 6000, durationMin: 45, materialCostCents: 800, isAddon: true },
    { name: "Fridge Interior", nameZh: "冰箱内部", category: "Add-on", priceCents: 3500, durationMin: 30, materialCostCents: 400, isAddon: true },
    { name: "Oven Deep Clean", nameZh: "烤箱深层清洁", category: "Add-on", priceCents: 4500, durationMin: 40, materialCostCents: 900, isAddon: true },
    { name: "Ironing Service", nameZh: "熨衣服务", category: "Add-on", priceCents: 4000, durationMin: 60, materialCostCents: 0, isAddon: true },
  ];
  const services = [];
  for (const s of svcSeed) services.push(await db.service.create({ data: s }));
  const mainSvcs = services.filter((s) => !s.isAddon);

  console.log("Expense categories…");
  const catNames = ["Fuel", "Cleaning Supplies", "Equipment", "Vehicle Maintenance", "Marketing", "Office & Admin", "Staff Welfare"];
  const cats = [];
  for (const name of catNames) cats.push(await db.expenseCategory.create({ data: { name } }));

  console.log("Customers…");
  const custSeed = [
    ["Tan Ai Lin", "ailin.tan@gmail.com", "012-556 7788", null, "Lot 88, Jalan Song", "Kuching"],
    ["Mohd Faizal Abdullah", "faizal.a@yahoo.com", "013-221 4455", null, "No. 12, Taman Sri Sarawak", "Kuching"],
    ["Green Valley Sdn Bhd", "admin@greenvalley.com.my", "082-556 700", "Green Valley Sdn Bhd", "Level 5, Wisma Saberkas", "Kuching"],
    ["Priya Ramasamy", "priya.r@outlook.com", "016-778 2211", null, "22A, Jalan Tabuan", "Kuching"],
    ["Wong Chee Keong", "ck.wong@gmail.com", "011-3344 5566", null, "45, Jalan Petanak", "Kuching"],
    ["Sarawak Dental Clinic", "reception@swkdental.my", "082-334 221", "Sarawak Dental Sdn Bhd", "Ground Floor, Jalan Rubber", "Kuching"],
    ["Nur Syafiqah", "syafiqah93@gmail.com", "014-909 1122", null, "Blok C-3-7, Riverine Resort", "Kuching"],
    ["James Anak Sagan", "james.sagan@gmail.com", "019-828 7766", null, "Kampung Semariang Baru", "Kuching"],
    ["Elaine Chong", "elaine.chong@gmail.com", "012-444 8899", null, "Villa 9, Tabuan Tranquility", "Kuching"],
    ["Borneo Highlands Resort", "ops@bhresort.my", "082-577 888", "Borneo Highlands Sdn Bhd", "Padawan Highlands", "Padawan"],
    ["Hafiz Rahman", "hafiz.r@gmail.com", "013-667 3311", null, "18, Jalan Ellis", "Kuching"],
    ["Michelle Ting", "michelle.ting@gmail.com", "016-202 4488", null, "7, Jalan Green", "Kuching"],
  ];
  const customers = [];
  for (const [name, email, phone, company, line1, city] of custSeed) {
    const c = await db.customer.create({ data: {
      name: name as string, email: email as string, phone: phone as string, company: company as string | null,
      notes: company ? "Commercial account — invoice monthly, 30 day terms." : null,
      createdAt: new Date(Date.now() - Math.floor(Math.random() * 200 + 30) * day),
      addresses: { create: { label: company ? "Office" : "Home", line1: line1 as string, city: city as string, state: "Sarawak", postcode: "93" + Math.floor(100 + Math.random() * 800), isPrimary: true, accessNotes: Math.random() > 0.6 ? "Key with guardhouse. Dog in back garden." : null } },
    }, include: { addresses: true } });
    customers.push(c);
  }
  // A second address for two customers
  await db.address.create({ data: { customerId: customers[2].id, label: "Branch — Samarahan", line1: "Lot 4, Kota Samarahan", city: "Samarahan", state: "Sarawak", postcode: "94300" } });
  await db.address.create({ data: { customerId: customers[0].id, label: "Parents' house", line1: "9, Jalan Stampin", city: "Kuching", state: "Sarawak", postcode: "93350" } });

  console.log("Bookings, jobs, invoices, payments across ~4 months…");
  let bN = 0, jN = 0, iN = 0, pN = 0, eN = 0;
  const ref = (p: string, n: number) => `${p}-${String(n).padStart(4, "0")}`;

  // Historic + upcoming: -100 days to +21 days
  for (let d = -100; d <= 21; d++) {
    const date = new Date(); date.setDate(date.getDate() + d);
    const dow = date.getDay();
    if (dow === 0) continue; // closed Sundays
    const count = d > 14 ? 1 : dow === 6 ? 2 : 2 + (d % 2);
    for (let k = 0; k < count; k++) {
      const cust = pick(customers, Math.abs(d * 3 + k * 5));
      const addr = await db.address.findFirst({ where: { customerId: cust.id, isPrimary: true } });
      const svc = pick(mainSvcs, Math.abs(d + k * 3));
      const addon = (d + k) % 4 === 0 ? pick(services.filter((s) => s.isAddon), Math.abs(d + k)) : null;
      const items = addon ? [svc, addon] : [svc];
      const hour = 9 + k * 3;
      const startAt = at(d, hour);
      const duration = items.reduce((a, s) => a + s.durationMin, 0);
      const revenue = items.reduce((a, s) => a + s.priceCents, 0);
      const material = items.reduce((a, s) => a + s.materialCostCents, 0);
      const past = d < 0;
      const cancelled = past && (d % 23 === 0);

      const booking = await db.booking.create({ data: {
        ref: ref("BKG", ++bN), customerId: cust.id, addressId: addr!.id, startAt, durationMin: duration,
        status: cancelled ? "CANCELLED" : past ? "COMPLETED" : "CONFIRMED",
        cancelReason: cancelled ? "Customer travelling" : null,
        notes: (d + k) % 5 === 0 ? "Please focus on the kitchen and bathrooms." : null,
        createdAt: new Date(startAt.getTime() - 5 * day),
        items: { create: items.map((s) => ({ serviceId: s.id, qty: 1, priceCents: s.priceCents, name: s.name })) },
      } });

      const jobStatus = cancelled ? "CANCELLED" : past ? "COMPLETED" : d === 0 && hour < new Date().getHours() ? "IN_PROGRESS" : "SCHEDULED";
      const job = await db.job.create({ data: {
        ref: ref("JOB", ++jN), bookingId: booking.id, customerId: cust.id, addressId: addr!.id,
        scheduledAt: startAt, durationMin: duration, status: jobStatus,
        completedAt: jobStatus === "COMPLETED" ? new Date(startAt.getTime() + duration * 60000) : null,
        revenueCents: revenue, materialCostCents: material,
        customerInstructions: booking.notes,
        staffNotes: jobStatus === "COMPLETED" && (d % 7 === 0) ? "Sofa stain treated, mostly lifted. Recommend follow-up." : null,
        createdAt: new Date(startAt.getTime() - 5 * day),
        checklist: { create: items.map((s, n) => ({ label: s.name, sort: n, done: jobStatus === "COMPLETED" })) },
      } });

      // Assign cleaners (leave a couple of upcoming jobs unassigned so the dashboard has something to flag)
      if (!cancelled && !(d > 3 && d % 9 === 0)) {
        const n1 = pick(staff, Math.abs(d + k));
        const two = duration > 240;
        const n2 = two ? pick(staff, Math.abs(d + k + 2)) : null;
        const ids = [...new Set([n1.id, ...(n2 && n2.id !== n1.id ? [n2.id] : [])])];
        await db.jobAssignment.createMany({ data: ids.map((sid, n) => ({ jobId: job.id, staffId: sid, isLead: n === 0 })) });
        if (jobStatus === "COMPLETED") {
          for (const sid of ids) {
            await db.timeEntry.create({ data: { jobId: job.id, staffId: sid,
              startAt, endAt: new Date(startAt.getTime() + (duration + (d % 3) * 10) * 60000) } });
          }
        }
      }

      // Invoice completed jobs
      if (jobStatus === "COMPLETED") {
        const issued = new Date(startAt.getTime() + day);
        const inv = await db.invoice.create({ data: {
          ref: ref("INV", ++iN), customerId: cust.id, issuedAt: issued,
          dueAt: new Date(issued.getTime() + 14 * day), taxRateBp: 0, status: "SENT",
          createdAt: issued,
          items: { create: items.map((s) => ({ name: s.name, qty: 1, priceCents: s.priceCents })) },
        } });
        await db.job.update({ where: { id: job.id }, data: { invoiceId: inv.id } });

        // Most get paid; some stay open, a few partial
        // Older debt is mostly collected; only recent invoices realistically linger.
        const aged = d < -30;
        const roll = aged ? Math.abs((d * 7 + k * 13)) % 10 % 7 : Math.abs((d * 7 + k * 13)) % 10;
        if (roll < 7) {
          await db.payment.create({ data: { ref: ref("PAY", ++pN), invoiceId: inv.id, customerId: cust.id,
            amountCents: revenue, method: pick(["CASH","BANK","EWALLET","CARD"], roll) as string,
            paidAt: new Date(issued.getTime() + (roll % 5) * day) } });
          await db.invoice.update({ where: { id: inv.id }, data: { status: "PAID" } });
        } else if (roll === 7) {
          const part = Math.round(revenue / 2);
          await db.payment.create({ data: { ref: ref("PAY", ++pN), invoiceId: inv.id, customerId: cust.id,
            amountCents: part, method: "BANK", paidAt: new Date(issued.getTime() + 3 * day), note: "Part payment" } });
          await db.invoice.update({ where: { id: inv.id }, data: { status: "PARTIAL" } });
        } else {
          const overdue = new Date(issued.getTime() + 14 * day) < new Date();
          await db.invoice.update({ where: { id: inv.id }, data: { status: overdue ? "OVERDUE" : "SENT" } });
        }
      }
    }

    // Expenses on most days
    if (d <= 0 && d % 2 === 0) {
      const cat = pick(cats, Math.abs(d));
      await db.expense.create({ data: {
        ref: ref("EXP", ++eN), categoryId: cat.id, amountCents: [4500, 12000, 8900, 23000, 6500, 15000][Math.abs(d) % 6],
        spentAt: date, vendor: pick(["Petronas","Shell","Mr DIY","Ace Hardware","Lazada","Tesco"], Math.abs(d)),
        note: cat.name === "Fuel" ? "Van refuel" : null,
        reimbursable: d % 6 === 0, staffId: d % 6 === 0 ? pick(staff, Math.abs(d)).id : null,
      } });
    }
  }

  console.log("Recurring series, quotes, payouts, notifications…");
  // A live weekly recurring series for a commercial client
  const recCust = customers[5];
  const recAddr = await db.address.findFirst({ where: { customerId: recCust.id } });
  const office = services.find((s) => s.name === "Office Cleaning")!;
  const parent = await db.booking.create({ data: {
    ref: ref("BKG", ++bN), customerId: recCust.id, addressId: recAddr!.id, startAt: at(2, 18),
    durationMin: office.durationMin, recurrence: "WEEKLY", recurUntil: new Date(Date.now() + 90 * day),
    notes: "After hours — clinic closes 6pm. Alarm code with reception.",
    items: { create: { serviceId: office.id, qty: 1, priceCents: office.priceCents, name: office.name } },
  } });
  await db.job.create({ data: { ref: ref("JOB", ++jN), bookingId: parent.id, customerId: recCust.id, addressId: recAddr!.id,
    scheduledAt: at(2, 18), durationMin: office.durationMin, revenueCents: office.priceCents, materialCostCents: office.materialCostCents,
    customerInstructions: parent.notes } });
  for (let w = 1; w <= 8; w++) {
    const when = at(2 + w * 7, 18);
    const b = await db.booking.create({ data: { ref: ref("BKG", ++bN), customerId: recCust.id, addressId: recAddr!.id,
      startAt: when, durationMin: office.durationMin, parentId: parent.id, notes: parent.notes,
      items: { create: { serviceId: office.id, qty: 1, priceCents: office.priceCents, name: office.name } } } });
    await db.job.create({ data: { ref: ref("JOB", ++jN), bookingId: b.id, customerId: recCust.id, addressId: recAddr!.id,
      scheduledAt: when, durationMin: office.durationMin, revenueCents: office.priceCents, materialCostCents: office.materialCostCents } });
  }

  const deep = services.find((s) => s.name === "Post-Renovation Clean")!;
  await db.quote.create({ data: { ref: "QT-0001", customerId: customers[9].id, status: "SENT",
    validUntil: new Date(Date.now() + 20 * day), discountCents: 5000, taxRateBp: 0,
    notes: "Quote covers 12 chalets. Two-day job, team of four.",
    items: { create: [
      { serviceId: deep.id, name: deep.name, qty: 12, priceCents: deep.priceCents },
      { name: "Travel surcharge — Padawan Highlands", qty: 1, priceCents: 15000 },
    ] } } });
  await db.quote.create({ data: { ref: "QT-0002", customerId: customers[8].id, status: "ACCEPTED",
    validUntil: new Date(Date.now() + 10 * day),
    items: { create: [{ serviceId: mainSvcs[1].id, name: mainSvcs[1].name, qty: 1, priceCents: mainSvcs[1].priceCents }] } } });
  await db.quote.create({ data: { ref: "QT-0003", customerId: customers[3].id, status: "DRAFT",
    items: { create: [{ serviceId: mainSvcs[2].id, name: mainSvcs[2].name, qty: 1, priceCents: mainSvcs[2].priceCents }] } } });

  for (let i = 0; i < 3; i++) {
    const s = staff[i];
    await db.payout.create({ data: { ref: ref("PO", i + 1), staffId: s.id,
      periodStart: new Date(Date.now() - (30 + i * 30) * day), periodEnd: new Date(Date.now() - (i * 30 + 1) * day),
      amountCents: [185000, 210000, 160000][i], status: i === 0 ? "PENDING" : "PAID",
      paidAt: i === 0 ? null : new Date(Date.now() - i * 28 * day) } });
  }

  await db.notification.createMany({ data: [
    { type: "PAYMENT_REMINDER", title: "3 invoices are overdue", body: "Chase outstanding balances", link: "/invoices?filter=overdue" },
    { type: "BOOKING_CONFIRMED", title: "New booking confirmed", body: "Michelle Ting · Deep Cleaning", link: "/bookings" },
    { type: "STAFF", title: "Payout pending", body: "Aisyah Binti Omar — RM 1,850.00", link: "/payroll" },
    { type: "REMINDER", title: "Jobs tomorrow need cleaners", body: "Some upcoming jobs are unassigned", link: "/calendar" },
  ] });

  await db.auditLog.create({ data: { userId: owner.id, actorName: "Siti Rahman", action: "system.seed",
    source: "system", result: "Demo dataset loaded", ok: true } });

  const counts = { customers: customers.length, staff: staff.length, services: services.length,
    bookings: bN, jobs: jN, invoices: iN, payments: pN, expenses: eN };
  console.log("Seeded:", counts);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
