// store-app/composables/useMobileStore.js
// Capacitor (mobile) implementation — mirrors ipc/store.js exactly.
// NEW: order_payments table, addOrderPayment, deleteOrderPayment, markOrderFullyPaid

import { getMobileDb } from "./useMobileDb";
import { generateUuid } from "./useUuid";

export const useMobileStore = () => {
  // ── Helpers ────────────────────────────────────────────────────────────────
  const enqueue = async (
    table,
    operation,
    rowId,
    payload = null,
    changedFields = null,
  ) => {
    const db = await getMobileDb();
    await db.run(
      `INSERT INTO sync_queue (table_name, operation, row_id, payload, changed_fields) VALUES (?, ?, ?, ?, ?)`,
      [
        table,
        operation,
        rowId,
        payload ? JSON.stringify(payload) : null,
        changedFields ? JSON.stringify(changedFields) : null,
      ],
    );
  };

  const fk = (v) => (v === undefined || v === null || v === "" ? null : v);

  const getDollarRate = async () => {
    const db = await getMobileDb();
    const r = (
      await db.query(`SELECT value FROM settings WHERE key='dollar_rate'`)
    ).values?.[0];
    return parseFloat(r?.value ?? "15000") || 15000;
  };

  const getReportCurrency = async () => {
    const db = await getMobileDb();
    const r = (
      await db.query(`SELECT value FROM settings WHERE key='report_currency'`)
    ).values?.[0];
    return r?.value ?? "SP";
  };

  const PRODUCT_JOIN = ["category_name"];
  const ORDER_JOIN = [
    "customer_name",
    "customer_phone",
    "item_count",
    "total_paid_sp",
  ];
  const DUE_JOIN = ["customer_name", "customer_phone"];
  const ITEM_JOIN = ["current_stock"];

  const strip = (obj, fields) => {
    if (!obj) return obj;
    const copy = { ...obj };
    for (const f of fields) delete copy[f];
    return copy;
  };

  const EDITABLE_FIELDS = {
    categories: ["name", "description"],
    products: [
      "name",
      "description",
      "category_id",
      "barcode",
      "buy_price",
      "sell_price",
      "currency",
      "stock",
      "min_stock",
      "unit",
      "image_url",
      "is_active",
    ],
    customers: ["name", "phone", "address", "notes"],
    orders: [
      "customer_id",
      "order_date",
      "status",
      "total_sp",
      "total_usd",
      "paid_amount",
      "display_currency",
      "notes",
    ],
    order_items: [
      "order_id",
      "product_id",
      "product_name",
      "quantity",
      "sell_price_at_sale",
      "currency_at_sale",
      "line_total_sp",
    ],
    order_payments: [
      "order_id",
      "amount",
      "currency",
      "amount_sp",
      "note",
      "paid_at",
    ],
    dues: [
      "customer_id",
      "order_id",
      "amount",
      "currency",
      "amount_sp",
      "description",
      "due_date",
      "paid",
      "paid_at",
    ],
    staff: [
      "full_name",
      "username",
      "password",
      "role",
      "phone",
      "email",
      "is_active",
    ],
  };

  const diffFields = (table, before, after) => {
    const fields = EDITABLE_FIELDS[table] ?? [];
    if (!before) return fields;
    return fields.filter(
      (f) => String(before[f] ?? "") !== String(after[f] ?? ""),
    );
  };

  const freshRow = async (table, id) => {
    const db = await getMobileDb();
    return (
      (await db.query(`SELECT * FROM "${table}" WHERE id=?`, [id]))
        .values?.[0] ?? null
    );
  };

  // ── Recalculate order from payments (mobile) ──────────────────────────────
  const recalcOrder = async (orderId) => {
    const db = await getMobileDb();
    const order = (await db.query(`SELECT * FROM orders WHERE id=?`, [orderId]))
      .values?.[0];
    if (!order) return null;
    const rate = await getDollarRate();

    const paidSP =
      (
        await db.query(
          `SELECT COALESCE(SUM(amount_sp),0) as n FROM order_payments WHERE order_id=? AND _deleted=0`,
          [orderId],
        )
      ).values?.[0]?.n ?? 0;

    let status;
    if (paidSP <= 0) status = "pending";
    else if (paidSP >= order.total_sp - 0.01) status = "paid";
    else status = "partly_paid";

    const paidDisplay =
      order.display_currency === "USD" ? paidSP / rate : paidSP;
    await db.run(
      `UPDATE orders SET paid_amount=?, status=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
      [paidDisplay, status, orderId],
    );

    if (status === "paid") {
      await db.run(
        `UPDATE dues SET paid=1, paid_at=datetime('now'), version=version+1, updated_at=datetime('now') WHERE order_id=? AND paid=0`,
        [orderId],
      );
      const updatedDues =
        (
          await db.query(`SELECT * FROM dues WHERE order_id=? AND paid=1`, [
            orderId,
          ])
        ).values ?? [];
      for (const due of updatedDues)
        await enqueue("dues", "update", due.id, strip(due, DUE_JOIN), [
          "paid",
          "paid_at",
        ]);
    }

    const freshOrder = await freshRow("orders", orderId);
    await enqueue("orders", "update", orderId, strip(freshOrder, ORDER_JOIN), [
      "paid_amount",
      "status",
    ]);
    return { paidSP, status };
  };

  const deriveStatus = (totalSp, paidAmount, displayCurrency, rate) => {
    const paidSp = displayCurrency === "USD" ? paidAmount * rate : paidAmount;
    if (paidSp <= 0) return "pending";
    if (paidSp >= totalSp - 0.001) return "paid";
    return "partly_paid";
  };

  const ensureDb = async () => {
    const db = await getMobileDb();
    if (!db) throw new Error("Database not initialized");
    return db;
  };

  // ── STATS ─────────────────────────────────────────────────────────────────
  const getStats = async () => {
    try {
      const db = await getMobileDb();
      const today = new Date().toISOString().slice(0, 10);
      const firstOfMonth = today.slice(0, 7) + "-01";
      const rate = await getDollarRate();
      const reportCurrency = await getReportCurrency();

      const totalProducts = (
        await db.query(
          `SELECT COUNT(*) as n FROM products WHERE _deleted=0 AND is_active=1`,
        )
      ).values[0].n;
      const totalCustomers = (
        await db.query(`SELECT COUNT(*) as n FROM customers WHERE _deleted=0`)
      ).values[0].n;
      const lowStock = (
        await db.query(
          `SELECT COUNT(*) as n FROM products WHERE _deleted=0 AND stock <= min_stock AND min_stock > 0`,
        )
      ).values[0].n;
      const todayOrders = (
        await db.query(
          `SELECT COUNT(*) as n FROM orders WHERE date(order_date)=? AND _deleted=0`,
          [today],
        )
      ).values[0].n;
      const monthCollectedSP = (
        await db.query(
          `
        SELECT COALESCE(SUM(op.amount_sp),0) as n
        FROM order_payments op JOIN orders o ON op.order_id=o.id
        WHERE op._deleted=0 AND o._deleted=0 AND date(op.paid_at) >= ?`,
          [firstOfMonth],
        )
      ).values[0].n;
      const unpaidDues = (
        await db.query(
          `SELECT COUNT(*) as n FROM dues WHERE paid=0 AND _deleted=0`,
        )
      ).values[0].n;
      const unpaidDuesAmount = (
        await db.query(
          `SELECT COALESCE(SUM(amount_sp),0) as n FROM dues WHERE paid=0 AND _deleted=0`,
        )
      ).values[0].n;

      const divisor = reportCurrency === "USD" ? rate : 1;
      return {
        ok: true,
        data: {
          totalProducts,
          totalCustomers,
          lowStock,
          todayOrders,
          monthRevenue: monthCollectedSP / divisor,
          reportCurrency,
          unpaidDues,
          unpaidDuesAmount: unpaidDuesAmount / divisor,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── CATEGORIES ─────────────────────────────────────────────────────────────
  const getCategories = async () => {
    try {
      const db = await ensureDb();
      return {
        ok: true,
        data:
          (
            await db.query(
              `SELECT * FROM categories WHERE _deleted=0 ORDER BY name`,
            )
          ).values ?? [],
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveCategory = async (cat) => {
    try {
      const db = await getMobileDb();
      if (cat.id) {
        const before = await freshRow("categories", cat.id);
        await db.run(
          `UPDATE categories SET name=?, description=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
          [cat.name, cat.description, cat.id],
        );
        const fresh = await freshRow("categories", cat.id);
        await enqueue(
          "categories",
          "update",
          cat.id,
          fresh,
          diffFields("categories", before, fresh),
        );
        return { ok: true, id: cat.id };
      } else {
        const id = generateUuid();
        await db.run(
          `INSERT INTO categories (id, name, description) VALUES (?, ?, ?)`,
          [id, cat.name, cat.description],
        );
        await enqueue(
          "categories",
          "insert",
          id,
          await freshRow("categories", id),
          null,
        );
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteCategory = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE categories SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("categories", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── PRODUCTS ───────────────────────────────────────────────────────────────
  const getProducts = async ({
    search = "",
    categoryId,
    limit = 50,
    offset = 0,
    activeOnly = false,
  } = {}) => {
    try {
      const db = await getMobileDb();
      const like = `%${search}%`;
      let where = "p._deleted=0";
      const params = [];
      if (search) {
        where += " AND (p.name LIKE ? OR p.barcode LIKE ?)";
        params.push(like, like);
      }
      if (categoryId) {
        where += " AND p.category_id=?";
        params.push(categoryId);
      }
      if (activeOnly) {
        where += " AND p.is_active=1";
      }
      const data =
        (
          await db.query(
            `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE ${where} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
            [...params, limit, offset],
          )
        ).values ?? [];
      const total = (
        await db.query(
          `SELECT COUNT(*) as n FROM products p WHERE ${where}`,
          params,
        )
      ).values[0].n;
      return { ok: true, data, total };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const getProductById = async (id) => {
    try {
      const db = await getMobileDb();
      const data = (
        await db.query(
          `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=? AND p._deleted=0`,
          [id],
        )
      ).values?.[0];
      if (!data) return { ok: false, error: "Not found" };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveProduct = async (p) => {
    try {
      const db = await getMobileDb();
      const clean = strip(p, PRODUCT_JOIN);
      if (clean.id) {
        const before = await freshRow("products", clean.id);
        await db.run(
          `UPDATE products SET name=?, description=?, category_id=?, barcode=?, buy_price=?, sell_price=?, currency=?, stock=?, min_stock=?, unit=?, image_url=?, is_active=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
          [
            clean.name,
            clean.description,
            fk(clean.category_id),
            clean.barcode,
            clean.buy_price,
            clean.sell_price,
            clean.currency,
            clean.stock,
            clean.min_stock,
            clean.unit,
            clean.image_url,
            clean.is_active,
            clean.id,
          ],
        );
        const fresh = await freshRow("products", clean.id);
        await enqueue(
          "products",
          "update",
          clean.id,
          strip(fresh, PRODUCT_JOIN),
          diffFields("products", before, fresh),
        );
        return { ok: true, id: clean.id };
      } else {
        const id = generateUuid();
        await db.run(
          `INSERT INTO products (id, name, description, category_id, barcode, buy_price, sell_price, currency, stock, min_stock, unit, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            clean.name,
            clean.description,
            fk(clean.category_id),
            clean.barcode,
            clean.buy_price,
            clean.sell_price,
            clean.currency,
            clean.stock,
            clean.min_stock,
            clean.unit,
            clean.image_url,
            clean.is_active,
          ],
        );
        await enqueue(
          "products",
          "insert",
          id,
          strip(await freshRow("products", id), PRODUCT_JOIN),
          null,
        );
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteProduct = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE products SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("products", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const adjustStock = async ({ id, delta }) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE products SET stock=MAX(0, stock + ?), version=version+1, updated_at=datetime('now') WHERE id=?`,
        [delta, id],
      );
      const fresh = await freshRow("products", id);
      await enqueue("products", "update", id, strip(fresh, PRODUCT_JOIN), [
        "stock",
      ]);
      return { ok: true, stock: fresh?.stock };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── CUSTOMERS ──────────────────────────────────────────────────────────────
  const getCustomers = async ({ search = "", limit = 50, offset = 0 } = {}) => {
    try {
      const db = await getMobileDb();
      const like = `%${search}%`;
      const data =
        (
          await db.query(
            `SELECT * FROM customers WHERE _deleted=0 AND (name LIKE ? OR phone LIKE ?) ORDER BY name ASC LIMIT ? OFFSET ?`,
            [like, like, limit, offset],
          )
        ).values ?? [];
      const total = (
        await db.query(
          `SELECT COUNT(*) as n FROM customers WHERE _deleted=0 AND (name LIKE ? OR phone LIKE ?)`,
          [like, like],
        )
      ).values[0].n;
      return { ok: true, data, total };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const getCustomerById = async (id) => {
    try {
      const db = await getMobileDb();
      const customer = (
        await db.query(`SELECT * FROM customers WHERE id=? AND _deleted=0`, [
          id,
        ])
      ).values?.[0];
      if (!customer) return { ok: false, error: "Not found" };
      const orders =
        (
          await db.query(
            `SELECT * FROM orders WHERE customer_id=? AND _deleted=0 ORDER BY order_date DESC LIMIT 50`,
            [id],
          )
        ).values ?? [];
      const dues =
        (
          await db.query(
            `SELECT * FROM dues WHERE customer_id=? AND _deleted=0 ORDER BY created_at DESC`,
            [id],
          )
        ).values ?? [];
      return { ok: true, data: { ...customer, orders, dues } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveCustomer = async (c) => {
    try {
      const db = await getMobileDb();
      if (c.id) {
        const before = await freshRow("customers", c.id);
        await db.run(
          `UPDATE customers SET name=?, phone=?, address=?, notes=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
          [c.name, c.phone, c.address, c.notes, c.id],
        );
        const fresh = await freshRow("customers", c.id);
        await enqueue(
          "customers",
          "update",
          c.id,
          fresh,
          diffFields("customers", before, fresh),
        );
        return { ok: true, id: c.id };
      } else {
        const id = generateUuid();
        await db.run(
          `INSERT INTO customers (id, name, phone, address, notes) VALUES (?, ?, ?, ?, ?)`,
          [id, c.name, c.phone, c.address, c.notes],
        );
        await enqueue(
          "customers",
          "insert",
          id,
          await freshRow("customers", id),
          null,
        );
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteCustomer = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE customers SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("customers", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const findOrCreateCustomer = async (name) => {
    try {
      const db = await getMobileDb();
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Name is required" };
      let customer = (
        await db.query(
          `SELECT * FROM customers WHERE name=? AND _deleted=0 LIMIT 1`,
          [trimmed],
        )
      ).values?.[0];
      if (!customer) {
        const id = generateUuid();
        await db.run(`INSERT INTO customers (id, name) VALUES (?, ?)`, [
          id,
          trimmed,
        ]);
        customer = (await db.query(`SELECT * FROM customers WHERE id=?`, [id]))
          .values?.[0];
        await enqueue("customers", "insert", id, customer, null);
      }
      return { ok: true, data: customer };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── ORDERS ─────────────────────────────────────────────────────────────────
  const getOrders = async ({
    search = "",
    status,
    customerId,
    dateFrom,
    dateTo,
    limit = 50,
    offset = 0,
  } = {}) => {
    try {
      const db = await getMobileDb();
      let where = "o._deleted=0";
      const params = [];
      if (search) {
        where += " AND (c.name LIKE ? OR CAST(o.id AS TEXT) LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }
      if (status) {
        where += " AND o.status=?";
        params.push(status);
      }
      if (customerId) {
        where += " AND o.customer_id=?";
        params.push(customerId);
      }
      if (dateFrom) {
        where += " AND date(o.order_date)>=?";
        params.push(dateFrom);
      }
      if (dateTo) {
        where += " AND date(o.order_date)<=?";
        params.push(dateTo);
      }
      const data =
        (
          await db.query(
            `
        SELECT o.*, c.name as customer_name, c.phone as customer_phone,
          (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND _deleted=0) as item_count,
          (SELECT COALESCE(SUM(amount_sp),0) FROM order_payments WHERE order_id=o.id AND _deleted=0) as total_paid_sp
        FROM orders o LEFT JOIN customers c ON o.customer_id=c.id
        WHERE ${where} ORDER BY o.order_date DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset],
          )
        ).values ?? [];
      const total = (
        await db.query(
          `SELECT COUNT(*) as n FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE ${where}`,
          params,
        )
      ).values[0].n;
      return { ok: true, data, total };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const getOrderById = async (id) => {
    try {
      const db = await getMobileDb();
      const order = (
        await db.query(
          `
        SELECT o.*, c.name as customer_name, c.phone as customer_phone,
          (SELECT COALESCE(SUM(amount_sp),0) FROM order_payments WHERE order_id=o.id AND _deleted=0) as total_paid_sp
        FROM orders o LEFT JOIN customers c ON o.customer_id=c.id
        WHERE o.id=? AND o._deleted=0`,
          [id],
        )
      ).values?.[0];
      if (!order) return { ok: false, error: "Not found" };
      order.items =
        (
          await db.query(
            `
        SELECT oi.*, p.stock AS current_stock, p.buy_price as buy_price_current
        FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id
        WHERE oi.order_id=? AND oi._deleted=0 ORDER BY oi.id ASC`,
            [id],
          )
        ).values ?? [];
      order.payments =
        (
          await db.query(
            `
        SELECT * FROM order_payments WHERE order_id=? AND _deleted=0 ORDER BY paid_at ASC`,
            [id],
          )
        ).values ?? [];
      return { ok: true, data: order };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveOrder = async ({ order, items }) => {
    try {
      const db = await getMobileDb();
      const rate = await getDollarRate();

      let totalSp = 0;
      for (const item of items) {
        totalSp +=
          item.currency_at_sale === "USD"
            ? item.sell_price_at_sale * item.quantity * rate
            : item.sell_price_at_sale * item.quantity;
      }
      const totalUsd = totalSp / rate;
      let orderId = order.id;

      if (orderId) {
        // EDIT: restore stock, delete old items
        const oldItems =
          (
            await db.query(
              `SELECT * FROM order_items WHERE order_id=? AND _deleted=0`,
              [orderId],
            )
          ).values ?? [];
        for (const oi of oldItems) {
          if (oi.product_id)
            await db.run(
              `UPDATE products SET stock=stock+?, version=version+1, updated_at=datetime('now') WHERE id=?`,
              [oi.quantity, oi.product_id],
            );
        }
        for (const oi of oldItems) {
          await db.run(
            `UPDATE order_items SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
            [oi.id],
          );
          await enqueue("order_items", "delete", oi.id, null, null);
        }

        // Recalc status from existing payments
        const existingPaidSP =
          (
            await db.query(
              `SELECT COALESCE(SUM(amount_sp),0) as n FROM order_payments WHERE order_id=? AND _deleted=0`,
              [orderId],
            )
          ).values?.[0]?.n ?? 0;
        let newStatus;
        if (existingPaidSP <= 0) newStatus = "pending";
        else if (existingPaidSP >= totalSp - 0.01) newStatus = "paid";
        else newStatus = "partly_paid";
        const paidDisplay =
          (order.display_currency ?? "SP") === "USD"
            ? existingPaidSP / rate
            : existingPaidSP;

        const orderBefore = await freshRow("orders", orderId);
        await db.run(
          `UPDATE orders SET customer_id=?, order_date=?, status=?, total_sp=?, total_usd=?, paid_amount=?, display_currency=?, notes=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
          [
            order.customer_id,
            order.order_date,
            newStatus,
            totalSp,
            totalUsd,
            paidDisplay,
            order.display_currency ?? "SP",
            order.notes,
            orderId,
          ],
        );
        const freshOrder = await freshRow("orders", orderId);
        await enqueue(
          "orders",
          "update",
          orderId,
          strip(freshOrder, ORDER_JOIN),
          diffFields("orders", orderBefore, freshOrder),
        );
      } else {
        orderId = generateUuid();
        await db.run(
          `INSERT INTO orders (id, customer_id, order_date, status, total_sp, total_usd, paid_amount, display_currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            order.customer_id,
            order.order_date ?? new Date().toISOString(),
            "pending",
            totalSp,
            totalUsd,
            0,
            order.display_currency ?? "SP",
            order.notes,
          ],
        );
        await enqueue(
          "orders",
          "insert",
          orderId,
          strip(await freshRow("orders", orderId), ORDER_JOIN),
          null,
        );
      }

      const affectedProductIds = new Set();
      for (const item of items) {
        const lineSP =
          item.currency_at_sale === "USD"
            ? item.sell_price_at_sale * item.quantity * rate
            : item.sell_price_at_sale * item.quantity;
        const itemId = generateUuid();
        await db.run(
          `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, sell_price_at_sale, currency_at_sale, line_total_sp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itemId,
            orderId,
            fk(item.product_id),
            item.product_name,
            item.quantity,
            item.sell_price_at_sale,
            item.currency_at_sale,
            lineSP,
          ],
        );
        if (item.product_id) {
          await db.run(
            `UPDATE products SET stock=MAX(0, stock - ?), version=version+1, updated_at=datetime('now') WHERE id=?`,
            [item.quantity, item.product_id],
          );
          affectedProductIds.add(item.product_id);
        }
        const freshItem = await freshRow("order_items", itemId);
        if (freshItem)
          await enqueue(
            "order_items",
            "insert",
            itemId,
            strip(freshItem, ITEM_JOIN),
            null,
          );
      }

      if (order.customer_id) {
        const custBefore = await freshRow("customers", order.customer_id);
        await db.run(
          `UPDATE customers SET total_orders=(SELECT COUNT(*) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'), total_spent=(SELECT COALESCE(SUM(total_sp),0) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'), last_order=datetime('now'), version=version+1, updated_at=datetime('now') WHERE id=?`,
          [order.customer_id, order.customer_id, order.customer_id],
        );
        const freshCust = await freshRow("customers", order.customer_id);
        if (freshCust)
          await enqueue(
            "customers",
            "update",
            order.customer_id,
            freshCust,
            diffFields("customers", custBefore, freshCust),
          );
      }

      for (const pid of affectedProductIds) {
        const prod = await freshRow("products", pid);
        if (prod)
          await enqueue("products", "update", pid, strip(prod, PRODUCT_JOIN), [
            "stock",
          ]);
      }

      return { ok: true, id: orderId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── ORDER PAYMENTS ────────────────────────────────────────────────────────

  const getOrderPayments = async (orderId) => {
    try {
      const db = await getMobileDb();
      const data =
        (
          await db.query(
            `SELECT * FROM order_payments WHERE order_id=? AND _deleted=0 ORDER BY paid_at ASC`,
            [orderId],
          )
        ).values ?? [];
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const addOrderPayment = async ({ order_id, amount, currency, note }) => {
    try {
      const db = await getMobileDb();
      const rate = await getDollarRate();
      const amount_sp = currency === "USD" ? amount * rate : amount;
      const id = generateUuid();
      await db.run(
        `INSERT INTO order_payments (id, order_id, amount, currency, amount_sp, note) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, order_id, amount, currency, amount_sp, note ?? null],
      );
      const fresh = await freshRow("order_payments", id);
      await enqueue("order_payments", "insert", id, fresh, null);
      await recalcOrder(order_id);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteOrderPayment = async (paymentId) => {
    try {
      const db = await getMobileDb();
      const payment = await freshRow("order_payments", paymentId);
      if (!payment) return { ok: false, error: "Not found" };
      await db.run(
        `UPDATE order_payments SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [paymentId],
      );
      await enqueue("order_payments", "delete", paymentId, null, null);
      await recalcOrder(payment.order_id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const markOrderFullyPaid = async ({ order_id, currency, note }) => {
    try {
      const db = await getMobileDb();
      const order = (
        await db.query(`SELECT * FROM orders WHERE id=? AND _deleted=0`, [
          order_id,
        ])
      ).values?.[0];
      if (!order) return { ok: false, error: "Not found" };
      const rate = await getDollarRate();
      const alreadyPaidSP =
        (
          await db.query(
            `SELECT COALESCE(SUM(amount_sp),0) as n FROM order_payments WHERE order_id=? AND _deleted=0`,
            [order_id],
          )
        ).values?.[0]?.n ?? 0;
      const remainingSP = order.total_sp - alreadyPaidSP;
      if (remainingSP <= 0.01) return { ok: true, id: null };
      const cur = currency ?? order.display_currency ?? "SP";
      const amount = cur === "USD" ? remainingSP / rate : remainingSP;
      const id = generateUuid();
      await db.run(
        `INSERT INTO order_payments (id, order_id, amount, currency, amount_sp, note) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, order_id, amount, cur, remainingSP, note ?? "Full payment"],
      );
      await enqueue(
        "order_payments",
        "insert",
        id,
        await freshRow("order_payments", id),
        null,
      );
      await recalcOrder(order_id);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // Legacy compat
  const updateOrderPayment = async ({ id, paid_amount, display_currency }) => {
    try {
      const db = await getMobileDb();
      const rate = await getDollarRate();
      const order = (await db.query(`SELECT * FROM orders WHERE id=?`, [id]))
        .values?.[0];
      if (!order) return { ok: false, error: "Not found" };
      const status = deriveStatus(
        order.total_sp,
        paid_amount,
        display_currency,
        rate,
      );
      await db.run(
        `UPDATE orders SET paid_amount=?, display_currency=?, status=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [paid_amount, display_currency, status, id],
      );
      if (status === "paid") {
        await db.run(
          `UPDATE dues SET paid=1, paid_at=datetime('now'), version=version+1, updated_at=datetime('now') WHERE order_id=? AND paid=0`,
          [id],
        );
        const updatedDues =
          (
            await db.query(`SELECT * FROM dues WHERE order_id=? AND paid=1`, [
              id,
            ])
          ).values ?? [];
        for (const due of updatedDues)
          await enqueue("dues", "update", due.id, strip(due, DUE_JOIN), [
            "paid",
            "paid_at",
          ]);
      }
      const freshOrder = await freshRow("orders", id);
      await enqueue("orders", "update", id, strip(freshOrder, ORDER_JOIN), [
        "paid_amount",
        "display_currency",
        "status",
      ]);
      return { ok: true, status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteOrder = async (id) => {
    try {
      const db = await getMobileDb();
      const items =
        (
          await db.query(
            `SELECT * FROM order_items WHERE order_id=? AND _deleted=0`,
            [id],
          )
        ).values ?? [];
      for (const item of items) {
        if (item.product_id) {
          await db.run(
            `UPDATE products SET stock=stock+?, version=version+1, updated_at=datetime('now') WHERE id=?`,
            [item.quantity, item.product_id],
          );
          const prod = await freshRow("products", item.product_id);
          if (prod)
            await enqueue(
              "products",
              "update",
              prod.id,
              strip(prod, PRODUCT_JOIN),
              ["stock"],
            );
        }
        await db.run(
          `UPDATE order_items SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
          [item.id],
        );
        await enqueue("order_items", "delete", item.id, null, null);
      }
      // Soft-delete payments
      const payments =
        (
          await db.query(
            `SELECT * FROM order_payments WHERE order_id=? AND _deleted=0`,
            [id],
          )
        ).values ?? [];
      for (const p of payments) {
        await db.run(
          `UPDATE order_payments SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
          [p.id],
        );
        await enqueue("order_payments", "delete", p.id, null, null);
      }
      await db.run(
        `UPDATE orders SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("orders", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── DUES ───────────────────────────────────────────────────────────────────
  const getDues = async ({
    customerId,
    paid,
    dateFrom,
    dateTo,
    limit = 50,
    offset = 0,
  } = {}) => {
    try {
      const db = await getMobileDb();
      let where = "d._deleted=0";
      const params = [];
      if (customerId) {
        where += " AND d.customer_id=?";
        params.push(customerId);
      }
      if (paid !== undefined && paid !== null && paid !== "") {
        where += " AND d.paid=?";
        params.push(paid ? 1 : 0);
      }
      if (dateFrom) {
        where += " AND date(d.created_at)>=?";
        params.push(dateFrom);
      }
      if (dateTo) {
        where += " AND date(d.created_at)<=?";
        params.push(dateTo);
      }
      const data =
        (
          await db.query(
            `SELECT d.*, c.name as customer_name, c.phone as customer_phone FROM dues d LEFT JOIN customers c ON d.customer_id=c.id WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset],
          )
        ).values ?? [];
      const total = (
        await db.query(
          `SELECT COUNT(*) as n FROM dues d WHERE ${where}`,
          params,
        )
      ).values[0].n;
      const totalUnpaidSp = (
        await db.query(
          `SELECT COALESCE(SUM(amount_sp),0) as n FROM dues WHERE _deleted=0 AND paid=0`,
        )
      ).values[0].n;
      return { ok: true, data, total, totalUnpaidSp };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveDue = async (due) => {
    try {
      const db = await getMobileDb();
      const rate = await getDollarRate();
      const amountSp = due.currency === "USD" ? due.amount * rate : due.amount;
      const cleanDue = strip(due, DUE_JOIN);
      if (due.id) {
        const before = await freshRow("dues", due.id);
        await db.run(
          `UPDATE dues SET customer_id=?, order_id=?, amount=?, currency=?, amount_sp=?, description=?, due_date=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
          [
            cleanDue.customer_id,
            cleanDue.order_id,
            cleanDue.amount,
            cleanDue.currency,
            amountSp,
            cleanDue.description,
            cleanDue.due_date,
            due.id,
          ],
        );
        const fresh = await freshRow("dues", due.id);
        await enqueue(
          "dues",
          "update",
          due.id,
          strip(fresh, DUE_JOIN),
          diffFields("dues", before, fresh),
        );
        return { ok: true, id: due.id };
      } else {
        const id = generateUuid();
        await db.run(
          `INSERT INTO dues (id, customer_id, order_id, amount, currency, amount_sp, description, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            cleanDue.customer_id,
            cleanDue.order_id,
            cleanDue.amount,
            cleanDue.currency,
            amountSp,
            cleanDue.description,
            cleanDue.due_date,
          ],
        );
        await enqueue(
          "dues",
          "insert",
          id,
          strip(await freshRow("dues", id), DUE_JOIN),
          null,
        );
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const markDuePaid = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE dues SET paid=1, paid_at=datetime('now'), version=version+1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      const fresh = await freshRow("dues", id);
      await enqueue("dues", "update", id, strip(fresh, DUE_JOIN), [
        "paid",
        "paid_at",
      ]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteDue = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE dues SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("dues", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── STAFF ──────────────────────────────────────────────────────────────────
  const getStaff = async ({ search = "" } = {}) => {
    try {
      const db = await getMobileDb();
      const like = `%${search}%`;
      return {
        ok: true,
        data:
          (
            await db.query(
              `SELECT id, full_name, username, role, phone, email, is_active, created_at FROM staff WHERE _deleted=0 AND (full_name LIKE ? OR username LIKE ?) ORDER BY full_name`,
              [like, like],
            )
          ).values ?? [],
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveStaff = async (s) => {
    try {
      const db = await getMobileDb();
      if (s.id) {
        const before = await freshRow("staff", s.id);
        if (s.password)
          await db.run(
            `UPDATE staff SET full_name=?, username=?, password=?, role=?, phone=?, email=?, is_active=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
            [
              s.full_name,
              s.username,
              s.password,
              s.role,
              s.phone,
              s.email,
              s.is_active,
              s.id,
            ],
          );
        else
          await db.run(
            `UPDATE staff SET full_name=?, username=?, role=?, phone=?, email=?, is_active=?, version=version+1, updated_at=datetime('now') WHERE id=?`,
            [
              s.full_name,
              s.username,
              s.role,
              s.phone,
              s.email,
              s.is_active,
              s.id,
            ],
          );
        const fresh = await freshRow("staff", s.id);
        const changed = diffFields("staff", before, fresh).filter(
          (f) => f !== "password",
        );
        await enqueue(
          "staff",
          "update",
          s.id,
          fresh ? { ...fresh, password: undefined } : { id: s.id },
          changed,
        );
        return { ok: true, id: s.id };
      } else {
        const id = generateUuid();
        await db.run(
          `INSERT INTO staff (id, full_name, username, password, role, phone, email, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            s.full_name,
            s.username,
            s.password,
            s.role,
            s.phone,
            s.email,
            s.is_active,
          ],
        );
        const fresh = await freshRow("staff", id);
        await enqueue(
          "staff",
          "insert",
          id,
          fresh
            ? { ...fresh, password: undefined }
            : { id, ...s, password: undefined },
          null,
        );
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteStaff = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE staff SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("staff", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── REPORTS ────────────────────────────────────────────────────────────────
  const getRevenueReport = async ({ dateFrom, dateTo } = {}) => {
    try {
      const db = await getMobileDb();
      const f = dateFrom || "2000-01-01";
      const t = dateTo || "2099-12-31";
      const rate = await getDollarRate();
      const reportCurrency = await getReportCurrency();
      const divisor = reportCurrency === "USD" ? rate : 1;

      const daily = (
        (
          await db.query(
            `
        SELECT date(op.paid_at) as day,
          COALESCE(SUM(op.amount_sp),0) as collected_sp,
          COUNT(DISTINCT op.order_id)   as payment_count
        FROM order_payments op JOIN orders o ON op.order_id=o.id
        WHERE op._deleted=0 AND o._deleted=0 AND date(op.paid_at) BETWEEN ? AND ?
        GROUP BY day ORDER BY day`,
            [f, t],
          )
        ).values ?? []
      ).map((row) => ({
        ...row,
        collected: row.collected_sp / divisor,
      }));

      const byStatus =
        (
          await db.query(
            `
        SELECT status, COUNT(*) as count, SUM(total_sp) as total_sp
        FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ? GROUP BY status`,
            [f, t],
          )
        ).values ?? [];

      const topProducts = (
        (
          await db.query(
            `
        SELECT oi.product_name, SUM(oi.quantity) as qty,
          SUM(oi.line_total_sp) as revenue_sp,
          COALESCE(SUM(oi.quantity * p.buy_price * CASE WHEN p.currency='USD' THEN ? ELSE 1 END),0) as cost_sp
        FROM order_items oi JOIN orders o ON oi.order_id=o.id
        LEFT JOIN products p ON oi.product_id=p.id
        WHERE oi._deleted=0 AND o._deleted=0 AND date(o.order_date) BETWEEN ? AND ?
        GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10`,
            [rate, f, t],
          )
        ).values ?? []
      ).map((row) => ({
        ...row,
        revenue: row.revenue_sp / divisor,
        cost: row.cost_sp / divisor,
        profit: (row.revenue_sp - row.cost_sp) / divisor,
      }));

      const totals =
        (
          await db.query(
            `
        SELECT COALESCE(SUM(total_sp),0) as order_value_sp, COUNT(*) as orders,
          COALESCE(SUM(CASE WHEN status='paid'        THEN total_sp ELSE 0 END),0) as fully_paid_sp,
          COALESCE(SUM(CASE WHEN status='partly_paid' THEN total_sp ELSE 0 END),0) as partly_paid_sp,
          COALESCE(SUM(CASE WHEN status='pending'     THEN total_sp ELSE 0 END),0) as pending_sp
        FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ?`,
            [f, t],
          )
        ).values?.[0] ?? {};

      const collectedSP =
        (
          await db.query(
            `
        SELECT COALESCE(SUM(op.amount_sp),0) as n
        FROM order_payments op JOIN orders o ON op.order_id=o.id
        WHERE op._deleted=0 AND o._deleted=0 AND date(op.paid_at) BETWEEN ? AND ?`,
            [f, t],
          )
        ).values?.[0]?.n ?? 0;

      const costSP =
        (
          await db.query(
            `
        SELECT COALESCE(SUM(oi.quantity * p.buy_price * CASE WHEN p.currency='USD' THEN ? ELSE 1 END),0) as n
        FROM order_items oi JOIN orders o ON oi.order_id=o.id
        LEFT JOIN products p ON oi.product_id=p.id
        WHERE oi._deleted=0 AND o._deleted=0 AND date(o.order_date) BETWEEN ? AND ?`,
            [rate, f, t],
          )
        ).values?.[0]?.n ?? 0;

      return {
        ok: true,
        data: {
          daily,
          byStatus,
          topProducts,
          reportCurrency,
          totals: {
            orderValue: totals.order_value_sp / divisor,
            orders: totals.orders,
            collected: collectedSP / divisor,
            outstanding:
              Math.max(0, totals.order_value_sp - collectedSP) / divisor,
            cost: costSP / divisor,
            profit: (collectedSP - costSP) / divisor,
            fullyPaid: totals.fully_paid_sp / divisor,
            partlyPaid: totals.partly_paid_sp / divisor,
            pending: totals.pending_sp / divisor,
          },
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const getDuesReport = async ({ dateFrom, dateTo } = {}) => {
    try {
      const db = await getMobileDb();
      const f = dateFrom || "2000-01-01";
      const t = dateTo || "2099-12-31";
      const rate = await getDollarRate();
      const reportCurrency = await getReportCurrency();
      const divisor = reportCurrency === "USD" ? rate : 1;
      const summary =
        (
          await db.query(
            `SELECT COUNT(*) as total_dues, COALESCE(SUM(CASE WHEN paid=0 THEN amount_sp ELSE 0 END),0) as unpaid_sp, COALESCE(SUM(CASE WHEN paid=1 THEN amount_sp ELSE 0 END),0) as paid_sp, COUNT(CASE WHEN paid=0 THEN 1 END) as unpaid_count, COUNT(CASE WHEN paid=1 THEN 1 END) as paid_count FROM dues WHERE _deleted=0 AND date(created_at) BETWEEN ? AND ?`,
            [f, t],
          )
        ).values?.[0] ?? {};
      const topDebtors = (
        (
          await db.query(
            `SELECT c.name, c.phone, COALESCE(SUM(d.amount_sp),0) as total_sp FROM dues d JOIN customers c ON d.customer_id=c.id WHERE d._deleted=0 AND d.paid=0 GROUP BY d.customer_id ORDER BY total_sp DESC LIMIT 10`,
          )
        ).values ?? []
      ).map((r) => ({ ...r, total: r.total_sp / divisor }));
      return {
        ok: true,
        data: {
          reportCurrency,
          unpaid: summary.unpaid_sp / divisor,
          paid: summary.paid_sp / divisor,
          unpaidCount: summary.unpaid_count,
          paidCount: summary.paid_count,
          topDebtors,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── SETTINGS ───────────────────────────────────────────────────────────────
  const getSettings = async () => {
    try {
      const db = await getMobileDb();
      return {
        ok: true,
        data: Object.fromEntries(
          (
            (await db.query(`SELECT key, value FROM settings`)).values ?? []
          ).map((r) => [r.key, r.value]),
        ),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const setSetting = async ({ key, value }) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [key, String(value ?? "")],
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── SYNC ───────────────────────────────────────────────────────────────────
  const getSyncQueue = async () => {
    try {
      const db = await getMobileDb();
      return {
        ok: true,
        data:
          (
            await db.query(
              `SELECT * FROM sync_queue WHERE synced_at IS NULL AND (retry_count IS NULL OR retry_count < 5) ORDER BY id ASC LIMIT 500`,
            )
          ).values ?? [],
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const markSynced = async (ids) => {
    try {
      if (!ids?.length) return { ok: true };
      const db = await getMobileDb();
      await db.run(
        `UPDATE sync_queue SET synced_at=datetime('now') WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`,
        ids,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const getLastSyncedAt = async () => {
    try {
      const db = await getMobileDb();
      return {
        ok: true,
        data:
          (
            await db.query(
              `SELECT value FROM sync_meta WHERE key='last_synced_at'`,
            )
          ).values?.[0]?.value ?? null,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const setLastSyncedAt = async (iso) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `INSERT INTO sync_meta (key, value) VALUES ('last_synced_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [iso],
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const applyRemoteRow = async ({ table, row }) => {
    try {
      const db = await getMobileDb();
      const ALLOWED = new Set([
        "categories",
        "products",
        "customers",
        "orders",
        "order_items",
        "order_payments",
        "dues",
        "staff",
      ]);
      if (!ALLOWED.has(table))
        return { ok: false, error: `Unknown table: ${table}` };
      const normalized = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === "synced_at") continue;
        if (typeof v === "boolean") normalized[k] = v ? 1 : 0;
        else normalized[k] = v;
      }
      if (!normalized.id) return { ok: false, error: "Missing row.id" };
      const existing = (
        await db.query(
          `SELECT version, updated_at FROM "${table}" WHERE id=?`,
          [normalized.id],
        )
      ).values?.[0];
      if (!existing) {
        normalized.synced_at = new Date().toISOString();
        const cols = Object.keys(normalized);
        await db.run("PRAGMA foreign_keys = OFF");
        try {
          await db.run(
            `INSERT OR IGNORE INTO "${table}" (${cols
              .map((c) => `"${c}"`)
              .join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
            cols.map((c) => normalized[c]),
          );
        } finally {
          await db.run("PRAGMA foreign_keys = ON");
        }
        return { ok: true };
      }
      const remoteVersion = normalized.version ?? 0;
      const localVersion = existing.version ?? 0;
      if (remoteVersion < localVersion) return { ok: true, skipped: true };
      if (remoteVersion === localVersion) {
        const pending = await db.query(
          `SELECT id FROM sync_queue WHERE row_id=? AND synced_at IS NULL LIMIT 1`,
          [normalized.id],
        );
        if ((normalized.updated_at ?? "") <= (existing.updated_at ?? "")) {
          if (pending.values?.length > 0) return { ok: true, skipped: true };
        }
      }
      const skipCols = new Set(["id", "synced_at", "created_at"]);
      const updateCols = Object.keys(normalized).filter(
        (k) => !skipCols.has(k),
      );
      if (updateCols.length === 0) return { ok: true };
      await db.run("PRAGMA foreign_keys = OFF");
      try {
        await db.run(
          `UPDATE "${table}" SET ${updateCols
            .map((c) => `"${c}" = ?`)
            .join(", ")}, synced_at=? WHERE id=?`,
          [
            ...updateCols.map((c) => normalized[c]),
            new Date().toISOString(),
            normalized.id,
          ],
        );
      } finally {
        await db.run("PRAGMA foreign_keys = ON");
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const fetchDollarRate = async () => {
    const sources = [
      {
        url: "https://sp-dollar.com/api/rates",
        extract: (j) => {
          const r = j?.usd?.sell ?? j?.USD?.sell ?? j?.dollar?.sell;
          return r ? { rate: Number(r), isOfficial: false } : null;
        },
      },
      {
        url: "https://www.lira-rate.com/api/v1/rates/syp",
        extract: (j) => {
          const r = j?.sell ?? j?.rate ?? j?.value;
          return r ? { rate: Number(r), isOfficial: false } : null;
        },
      },
      {
        url: "https://api.exchangerate-api.com/v4/latest/USD",
        extract: (j) => {
          const r = j?.rates?.SYP;
          return r ? { rate: Number(r), isOfficial: true } : null;
        },
      },
    ];
    for (const source of sources) {
      try {
        const res = await fetch(source.url);
        if (!res.ok) continue;
        const json = await res.json();
        const result = source.extract(json);
        if (result?.rate && result.rate > 100) return { ok: true, ...result };
      } catch {
        /* try next */
      }
    }
    return { ok: false, error: "Could not fetch rate from any source" };
  };

  return {
    getStats,
    getCategories,
    saveCategory,
    deleteCategory,
    getProducts,
    getProductById,
    saveProduct,
    deleteProduct,
    adjustStock,
    getCustomers,
    getCustomerById,
    saveCustomer,
    deleteCustomer,
    findOrCreateCustomer,
    getOrders,
    getOrderById,
    saveOrder,
    updateOrderPayment,
    deleteOrder,
    getOrderPayments,
    addOrderPayment,
    deleteOrderPayment,
    markOrderFullyPaid,
    getDues,
    saveDue,
    markDuePaid,
    deleteDue,
    getStaff,
    saveStaff,
    deleteStaff,
    getRevenueReport,
    getDuesReport,
    getSettings,
    setSetting,
    fetchDollarRate,
    getSyncQueue,
    markSynced,
    getLastSyncedAt,
    setLastSyncedAt,
    applyRemoteRow,
  };
};
