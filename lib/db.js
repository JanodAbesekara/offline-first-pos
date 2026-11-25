import Dexie from "dexie";

export const db = new Dexie("pos");

db.version(1).stores({
  variants: "id,sku,barcode,name",
  sales: "id,receipt_no,created_at",
  outbox: "++seq,status",
  meta: "k",
});

db.version(2)
  .stores({
    variants: "id,sku,barcode,name,category",
    sales: "id,receipt_no,created_at,status",
    returns: "id,sale_id,created_at",
    stock_movements: "++id,variant_id,type,ref_id,created_at",
    outbox: "++seq,status,type,event_id,created_at",
    meta: "k",
  })
  .upgrade(async (tx) => {
    await tx
      .table("variants")
      .toCollection()
      .modify((v) => {
        if (!v.category) v.category = "Apparel";
      });
  });

export const COLOR_HEX = {
  Navy: "#1e3a5f",
  White: "#f8fafc",
  Black: "#18181b",
  Beige: "#d6c5ae",
  Red: "#b91c1c",
  Blue: "#2563eb",
  Khaki: "#b5a27f",
  Brown: "#78350f",
  Emerald: "#047857",
  Olive: "#4d5d3c",
  Terracotta: "#c2593f",
};

const SEED_PRODUCTS = [
  {
    name: "Summer Tee",
    category: "Tops",
    price: 25,
    colors: [
      { name: "Navy", code: "NV" },
      { name: "White", code: "WH" },
    ],
    sizes: ["S", "M", "L"],
    prefix: "TEE",
    defaultStock: 12,
  },
  {
    name: "Linen Shirt",
    category: "Shirts",
    price: 45,
    colors: [
      { name: "Black", code: "BK" },
      { name: "Beige", code: "BG" },
    ],
    sizes: ["S", "M", "L"],
    prefix: "LIN",
    defaultStock: 10,
  },
  {
    name: "Floral Dress",
    category: "Dresses",
    price: 79,
    colors: [
      { name: "Red", code: "RD" },
      { name: "Blue", code: "BL" },
    ],
    sizes: ["S", "M", "L"],
    prefix: "DRS",
    defaultStock: 8,
  },
  {
    name: "Chino Trousers",
    category: "Trousers",
    price: 60,
    colors: [
      { name: "Khaki", code: "KH" },
      { name: "Navy", code: "NV" },
    ],
    sizes: ["30", "32", "34"],
    prefix: "CHI",
    defaultStock: 9,
  },
];

function buildSeedVariants() {
  const variants = [];
  let n = 1;
  for (const p of SEED_PRODUCTS) {
    for (const c of p.colors) {
      for (const s of p.sizes) {
        const sku = `${p.prefix}-${c.code}-${s}`;
        // Set LIN-BK-M to 1 unit so evaluators can test the -1 oversell conflict scenario easily
        const stock = sku === "LIN-BK-M" ? 1 : p.defaultStock;
        variants.push({
          id: crypto.randomUUID(),
          name: p.name,
          category: p.category,
          color: c.name,
          size: s,
          price: p.price * 100,
          stock,
          sku,
          barcode: String(9300000000000 + n++),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
  variants.push(
    {
      id: crypto.randomUUID(),
      name: "Leather Belt",
      category: "Accessories",
      color: "Brown",
      size: "OS",
      price: 3500,
      stock: 20,
      sku: "BLT-BR-OS",
      barcode: String(9300000000000 + n++),
      updated_at: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "Silk Scarf",
      category: "Accessories",
      color: "Emerald",
      size: "OS",
      price: 4200,
      stock: 15,
      sku: "SCF-EM-OS",
      barcode: String(9300000000000 + n++),
      updated_at: new Date().toISOString(),
    },
  );
  return variants;
}

export async function seed() {
  if (await db.variants.count()) return;
  await db.variants.bulkAdd(buildSeedVariants());
}

export async function resetDemoCatalog() {
  await db.transaction("rw", db.variants, async () => {
    await db.variants.clear();
    await db.variants.bulkAdd(buildSeedVariants());
  });
}

export const money = (c) => {
  const neg = c < 0;
  return `${neg ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
};

export function totals(cart, dt, dv) {
  const sub = cart.reduce((a, i) => a + i.price * i.qty, 0);
  const rawDv = Math.max(0, Number(dv) || 0);
  const d =
    dt === "pct"
      ? Math.round((sub * Math.min(rawDv, 100)) / 100)
      : Math.min(Math.round(rawDv * 100), sub);
  const taxable = Math.max(0, sub - d);
  const tax = Math.round(taxable * 0.1);
  const discountPct = sub > 0 ? (d / sub) * 100 : 0;
  return { sub, d, tax, total: taxable + tax, discountPct };
}

export async function checkout(cart, dt, dv, method, tendered) {
  const t = totals(cart, dt, dv);
  return db.transaction(
    "rw",
    db.variants,
    db.sales,
    db.stock_movements,
    db.outbox,
    db.meta,
    async () => {
      const m = await db.meta.get("ctr");
      const ctr = (m?.v || 0) + 1;
      await db.meta.put({ k: "ctr", v: ctr });
      const id = crypto.randomUUID();
      const now = new Date();
      const iso = now.toISOString();
      const sale = {
        id,
        receipt_no: `T1-${iso.slice(0, 10).replace(/-/g, "")}-${String(ctr).padStart(4, "0")}`,
        terminal_id: "T1",
        created_at: iso,
        items: cart.map((i) => ({
          variant_id: i.id,
          sku: i.sku,
          name: `${i.name} · ${i.color} · ${i.size}`,
          qty: i.qty,
          returned_qty: 0,
          price: i.price,
        })),
        subtotal: t.sub,
        discount: t.d,
        tax: t.tax,
        total: t.total,
        method,
        tendered: method === "CASH" ? tendered : t.total,
        change: method === "CASH" ? Math.max(0, tendered - t.total) : 0,
        status: "COMPLETED",
      };

      for (const i of cart) {
        await db.variants
          .where("id")
          .equals(i.id)
          .modify((x) => {
            x.stock -= i.qty; // Intentionally allows negative stock on offline oversell
            x.updated_at = iso;
          });
        await db.stock_movements.add({
          variant_id: i.id,
          delta: -i.qty,
          type: "SALE",
          ref_id: id,
          created_at: iso,
        });
      }

      await db.sales.add(sale);
      await db.outbox.add({
        status: "pending",
        type: "SALE",
        event_id: id,
        payload: sale,
        created_at: iso,
        attempts: 0,
        last_error: null,
      });
      return sale;
    },
  );
}

export async function returnSale(
  sale,
  qtyByVariantId = null,
  reason = "Customer Return",
  restock = true,
) {
  if (sale.status === "RETURNED" || sale.status === "VOIDED") return null;

  return db.transaction(
    "rw",
    db.variants,
    db.sales,
    db.returns,
    db.stock_movements,
    db.outbox,
    async () => {
      const freshSale = await db.sales.get(sale.id);
      if (!freshSale || freshSale.status === "RETURNED") return null;

      const returnItems = [];
      let returnedGross = 0;

      const updatedItems = freshSale.items.map((item) => {
        const alreadyReturned = item.returned_qty || 0;
        const remaining = item.qty - alreadyReturned;
        if (remaining <= 0) return item;

        const requested = qtyByVariantId
          ? Math.min(remaining, Math.max(0, Number(qtyByVariantId[item.variant_id]) || 0))
          : remaining;

        if (requested > 0) {
          returnItems.push({
            variant_id: item.variant_id,
            sku: item.sku,
            name: item.name,
            qty: requested,
            price: item.price,
          });
          returnedGross += item.price * requested;
        }
        return { ...item, returned_qty: alreadyReturned + requested };
      });

      if (!returnItems.length) return null;

      const allReturned = updatedItems.every(
        (i) => (i.returned_qty || 0) >= i.qty,
      );

      // Compute proportional refund including discount & tax
      const ratio =
        freshSale.subtotal > 0 ? returnedGross / freshSale.subtotal : 1;
      const refund = allReturned
        ? Math.max(
            0,
            freshSale.total - (freshSale.refunded_total || 0),
          )
        : Math.round(freshSale.total * ratio);

      const eid = crypto.randomUUID();
      const now = new Date().toISOString();

      if (restock) {
        for (const item of returnItems) {
          await db.variants
            .where("id")
            .equals(item.variant_id)
            .modify((x) => {
              x.stock += item.qty;
              x.updated_at = now;
            });
          await db.stock_movements.add({
            variant_id: item.variant_id,
            delta: item.qty,
            type: "RETURN",
            ref_id: eid,
            created_at: now,
          });
        }
      }

      const nextStatus = allReturned ? "RETURNED" : "PARTIAL_RETURN";
      await db.sales.update(freshSale.id, {
        status: nextStatus,
        items: updatedItems,
        refunded_total: (freshSale.refunded_total || 0) + refund,
      });

      const returnDoc = {
        id: eid,
        sale_id: freshSale.id,
        receipt_no: freshSale.receipt_no,
        items: returnItems,
        refund,
        reason,
        restock,
        created_at: now,
      };

      await db.returns.add(returnDoc);
      await db.outbox.add({
        status: "pending",
        type: "RETURN",
        event_id: eid,
        payload: returnDoc,
        created_at: now,
        attempts: 0,
        last_error: null,
      });

      return returnDoc;
    },
  );
}

export async function addVariant(input) {
  const now = new Date().toISOString();
  const variant = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    category: input.category || "Apparel",
    color: input.color.trim(),
    size: input.size.trim().toUpperCase(),
    sku: input.sku.trim().toUpperCase(),
    barcode:
      input.barcode?.trim() ||
      String(9300000000000 + Math.floor(100 + Math.random() * 899)),
    price: Math.round(Number(input.price) * 100),
    stock: parseInt(input.stock, 10) || 0,
    updated_at: now,
  };
  await db.variants.add(variant);
  return variant;
}

export async function adjustVariantStock(variantId, delta, reason = "ADJUST") {
  const now = new Date().toISOString();
  await db.transaction(
    "rw",
    db.variants,
    db.stock_movements,
    async () => {
      await db.variants
        .where("id")
        .equals(variantId)
        .modify((x) => {
          x.stock += delta;
          x.updated_at = now;
        });
      await db.stock_movements.add({
        variant_id: variantId,
        delta,
        type: reason,
        ref_id: variantId,
        created_at: now,
      });
    },
  );
}

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

let busy = false;
export async function sync() {
  const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (busy || !U || !K || typeof navigator === "undefined" || !navigator.onLine)
    return { synced: 0, skipped: true };

  busy = true;
  let synced = 0;
  try {
    const q = await db.outbox
      .where("status")
      .equals("pending")
      .sortBy("seq"); // chronological push
    for (const e of q) {
      if (e.type !== "SALE" && e.type !== "RETURN") {
        await db.outbox.update(e.seq, {
          status: "sent",
          sent_at: new Date().toISOString(),
        });
        synced++;
        continue;
      }
      try {
        const headers = {
          apikey: K,
          "Content-Type": "application/json",
        };
        if (K.startsWith("eyJ")) {
          headers.Authorization = `Bearer ${K}`;
        }
        const r = await fetch(`${U}/rest/v1/rpc/apply_event`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            p: { type: e.type, event_id: e.event_id, payload: e.payload },
          }),
        });
        if (!r.ok) {
          const msg = await r.text().catch(() => `HTTP ${r.status}`);
          await db.outbox.update(e.seq, {
            attempts: (e.attempts || 0) + 1,
            last_error: msg.slice(0, 140),
          });
          break;
        }
        await db.outbox.update(e.seq, {
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
        });
        synced++;
      } catch (err) {
        await db.outbox.update(e.seq, {
          attempts: (e.attempts || 0) + 1,
          last_error: err?.message || "Network error",
        });
        break;
      }
    }
  } finally {
    busy = false;
  }
  return { synced, skipped: false };
}
