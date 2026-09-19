/**
 * The starter service catalogue. Shared by the demo seed and by
 * `npm run catalogue -- --yes`, which puts it back after a full reset.
 */
export const catalogue = [
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

/** Starter expense categories, same idea as the service list above. */
export const expenseCategories = ["Fuel", "Cleaning Supplies", "Equipment", "Vehicle Maintenance", "Marketing", "Office & Admin", "Staff Welfare"];
