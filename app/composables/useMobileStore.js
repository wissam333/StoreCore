// store-app/composables/useMobileStore.js
// Capacitor (mobile) implementation — mirrors ipc/store.js exactly.
import { getMobileDb } from "./useMobileDb";

export const useMobileStore = () => {
  // ── Helpers ────────────────────────────────────────────────────────────────
  const enqueue = async (table, operation, rowId, payload = null) => {
    const db = await getMobileDb();
    await db.run(
      `INSERT INTO sync_queue (table_name, operation, row_id, payload) VALUES (?, ?, ?, ?)`,
      [table, operation, rowId, payload ? JSON.stringify(payload) : null],
    );
  };

  const getDollarRate = async () => {
    const db = await getMobileDb();
    const r = (
      await db.query(`SELECT value FROM settings WHERE key='dollar_rate'`)
    ).values?.[0];
    return parseFloat(r?.value ?? "15000") || 15000;
  };

  const deriveStatus = (totalSp, paidAmount, displayCurrency, rate) => {
    const paidSp = displayCurrency === "USD" ? paidAmount * rate : paidAmount;
    if (paidSp <= 0) return "pending";
    if (paidSp >= totalSp - 0.001) return "paid";
    return "partly_paid";
  };

  const getReportCurrency = async () => {
    const db = await getMobileDb();
    const r = (
      await db.query(`SELECT value FROM settings WHERE key='report_currency'`)
    ).values?.[0];
    return r?.value ?? "SP";
  };

  // ── Strip JOIN-computed fields before enqueueing ───────────────────────────
  // These come from SELECT JOINs and are NOT real columns — sending them to
  // the server causes upsert to write them into columns that don't exist.
  const PRODUCT_JOIN = ["category_name"];
  const ORDER_JOIN = [
    "customer_name",
    "customer_phone",
    "item_count",
    "current_stock",
    "current_name",
  ];
  const DUE_JOIN = ["customer_name", "customer_phone"];
  const ITEM_JOIN = ["current_stock", "current_name"];

  const strip = (obj, fields) => {
    if (!obj) return obj;
    const copy = { ...obj };
    for (const f of fields) delete copy[f];
    return copy;
  };

  // ── STATS ──────────────────────────────────────────────────────────────────
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
      const monthRevSP = (
        await db.query(
          `SELECT COALESCE(SUM(total_sp),0) as n FROM orders WHERE status='paid' AND _deleted=0 AND order_date >= ?`,
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
          monthRevenue: monthRevSP / divisor,
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
      const db = await getMobileDb();
      const data =
        (
          await db.query(
            `SELECT * FROM categories WHERE _deleted=0 ORDER BY name`,
          )
        ).values ?? [];
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveCategory = async (cat) => {
    try {
      const db = await getMobileDb();
      if (cat.id) {
        await db.run(
          `UPDATE categories SET name=?, description=?, updated_at=datetime('now') WHERE id=?`,
          [cat.name, cat.description, cat.id],
        );
        await enqueue("categories", "update", cat.id, cat);
        return { ok: true, id: cat.id };
      } else {
        const r = await db.run(
          `INSERT INTO categories (name, description) VALUES (?, ?)`,
          [cat.name, cat.description],
        );
        const id = r.changes?.lastId;
        await enqueue("categories", "insert", id, { ...cat, id });
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
        `UPDATE categories SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("categories", "delete", id);
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
        await db.run(
          `UPDATE products SET name=?, description=?, category_id=?, barcode=?, buy_price=?, sell_price=?, currency=?, stock=?, min_stock=?, unit=?, image_url=?, is_active=?, updated_at=datetime('now') WHERE id=?`,
          [
            clean.name,
            clean.description,
            clean.category_id,
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
        await enqueue("products", "update", clean.id, clean);
        return { ok: true, id: clean.id };
      } else {
        const r = await db.run(
          `INSERT INTO products (name, description, category_id, barcode, buy_price, sell_price, currency, stock, min_stock, unit, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            clean.name,
            clean.description,
            clean.category_id,
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
        const id = r.changes?.lastId;
        await enqueue("products", "insert", id, { ...clean, id });
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
        `UPDATE products SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("products", "delete", id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const adjustStock = async ({ id, delta }) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE products SET stock=MAX(0, stock + ?), updated_at=datetime('now') WHERE id=?`,
        [delta, id],
      );
      // FIX: send full product row so updated_at propagates correctly
      const full = (await db.query(`SELECT * FROM products WHERE id=?`, [id]))
        .values?.[0];
      await enqueue("products", "update", id, full ?? { id, stock: 0 });
      return { ok: true, stock: full?.stock };
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
        await db.run(
          `UPDATE customers SET name=?, phone=?, address=?, notes=?, updated_at=datetime('now') WHERE id=?`,
          [c.name, c.phone, c.address, c.notes, c.id],
        );
        await enqueue("customers", "update", c.id, c);
        return { ok: true, id: c.id };
      } else {
        const r = await db.run(
          `INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)`,
          [c.name, c.phone, c.address, c.notes],
        );
        const id = r.changes?.lastId;
        await enqueue("customers", "insert", id, { ...c, id });
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
        `UPDATE customers SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("customers", "delete", id);
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
        const r = await db.run(`INSERT INTO customers (name) VALUES (?)`, [
          trimmed,
        ]);
        const id = r.changes?.lastId;
        customer = (await db.query(`SELECT * FROM customers WHERE id=?`, [id]))
          .values?.[0];
        await enqueue("customers", "insert", id, customer);
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
            `SELECT o.*, c.name as customer_name, c.phone as customer_phone,
         (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND _deleted=0) as item_count
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
          `SELECT o.*, c.name as customer_name, c.phone as customer_phone
         FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
         WHERE o.id = ? AND o._deleted = 0`,
          [id],
        )
      ).values?.[0];
      if (!order) return { ok: false, error: "Not found" };

      // FIX: product_name is a snapshot on the item — never depends on products table
      // LEFT JOIN products only for current_stock (edit form) — won't drop rows if product missing
      order.items =
        (
          await db.query(
            `SELECT oi.*, p.stock AS current_stock
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ? AND oi._deleted = 0
         ORDER BY oi.id ASC`,
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
        const lineSP =
          item.currency_at_sale === "USD"
            ? item.sell_price_at_sale * item.quantity * rate
            : item.sell_price_at_sale * item.quantity;
        totalSp += lineSP;
      }
      const totalUsd = totalSp / rate;
      const status = deriveStatus(
        totalSp,
        order.paid_amount ?? 0,
        order.display_currency ?? "SP",
        rate,
      );

      let orderId = order.id;

      if (orderId) {
        const oldItems =
          (
            await db.query(
              `SELECT * FROM order_items WHERE order_id=? AND _deleted=0`,
              [orderId],
            )
          ).values ?? [];
        for (const oi of oldItems) {
          await db.run(
            `UPDATE products SET stock=stock+?, updated_at=datetime('now') WHERE id=?`,
            [oi.quantity, oi.product_id],
          );
        }
        await db.run(
          `UPDATE order_items SET _deleted=1, updated_at=datetime('now') WHERE order_id=?`,
          [orderId],
        );
        const cleanOrder = strip(order, ORDER_JOIN);
        await db.run(
          `UPDATE orders SET customer_id=?, order_date=?, status=?, total_sp=?, total_usd=?, paid_amount=?, display_currency=?, notes=?, updated_at=datetime('now') WHERE id=?`,
          [
            cleanOrder.customer_id,
            cleanOrder.order_date,
            status,
            totalSp,
            totalUsd,
            cleanOrder.paid_amount ?? 0,
            cleanOrder.display_currency ?? "SP",
            cleanOrder.notes,
            orderId,
          ],
        );
      } else {
        const r = await db.run(
          `INSERT INTO orders (customer_id, order_date, status, total_sp, total_usd, paid_amount, display_currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            order.customer_id,
            order.order_date ?? new Date().toISOString(),
            status,
            totalSp,
            totalUsd,
            order.paid_amount ?? 0,
            order.display_currency ?? "SP",
            order.notes,
          ],
        );
        orderId = r.changes?.lastId;
      }

      // Insert new items + decrease stock
      for (const item of items) {
        const lineSP =
          item.currency_at_sale === "USD"
            ? item.sell_price_at_sale * item.quantity * rate
            : item.sell_price_at_sale * item.quantity;
        await db.run(
          `INSERT INTO order_items (order_id, product_id, product_name, quantity, sell_price_at_sale, currency_at_sale, line_total_sp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.product_id,
            item.product_name,
            item.quantity,
            item.sell_price_at_sale,
            item.currency_at_sale,
            lineSP,
          ],
        );
        if (item.product_id) {
          await db.run(
            `UPDATE products SET stock=MAX(0, stock - ?), updated_at=datetime('now') WHERE id=?`,
            [item.quantity, item.product_id],
          );
        }
      }

      // Update customer stats
      if (order.customer_id) {
        await db.run(
          `UPDATE customers SET
            total_orders=(SELECT COUNT(*) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'),
            total_spent=(SELECT COALESCE(SUM(total_sp),0) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'),
            last_order=datetime('now'), updated_at=datetime('now')
           WHERE id=?`,
          [order.customer_id, order.customer_id, order.customer_id],
        );
      }

      // FIX: also mark linked dues paid AND enqueue those dues so desktop sees the change
      if (status === "paid") {
        await db.run(
          `UPDATE dues SET paid=1, paid_at=datetime('now'), updated_at=datetime('now') WHERE order_id=? AND paid=0`,
          [orderId],
        );
        // Enqueue each updated due so the change syncs to desktop
        const updatedDues =
          (
            await db.query(`SELECT * FROM dues WHERE order_id=? AND paid=1`, [
              orderId,
            ])
          ).values ?? [];
        for (const due of updatedDues) {
          await enqueue("dues", "update", due.id, strip(due, DUE_JOIN));
        }
      }

      // Enqueue order — strip join fields
      const cleanOrder = strip(order, ORDER_JOIN);
      await enqueue("orders", order.id ? "update" : "insert", orderId, {
        ...cleanOrder,
        id: orderId,
        status,
        total_sp: totalSp,
        total_usd: totalUsd,
      });

      // FIX: also enqueue all order_items so they sync to other devices
      const savedItems =
        (
          await db.query(
            `SELECT * FROM order_items WHERE order_id=? AND _deleted=0`,
            [orderId],
          )
        ).values ?? [];
      for (const item of savedItems) {
        const cleanItem = strip(item, ITEM_JOIN);
        await enqueue("order_items", "insert", item.id, cleanItem);
      }

      // FIX: enqueue updated product stocks so other devices see qty changes
      for (const item of items) {
        if (item.product_id) {
          const prod = (
            await db.query(`SELECT * FROM products WHERE id=?`, [
              item.product_id,
            ])
          ).values?.[0];
          if (prod)
            await enqueue(
              "products",
              "update",
              prod.id,
              strip(prod, PRODUCT_JOIN),
            );
        }
      }

      return { ok: true, id: orderId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

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
        `UPDATE orders SET paid_amount=?, display_currency=?, status=?, updated_at=datetime('now') WHERE id=?`,
        [paid_amount, display_currency, status, id],
      );

      if (status === "paid") {
        await db.run(
          `UPDATE dues SET paid=1, paid_at=datetime('now'), updated_at=datetime('now') WHERE order_id=? AND paid=0`,
          [id],
        );
        // FIX: enqueue the updated dues so desktop sees them
        const updatedDues =
          (
            await db.query(`SELECT * FROM dues WHERE order_id=? AND paid=1`, [
              id,
            ])
          ).values ?? [];
        for (const due of updatedDues) {
          await enqueue("dues", "update", due.id, strip(due, DUE_JOIN));
        }
      }

      // FIX: send full order row so updated_at propagates
      const updatedOrder = (
        await db.query(`SELECT * FROM orders WHERE id=?`, [id])
      ).values?.[0];
      await enqueue("orders", "update", id, strip(updatedOrder, ORDER_JOIN));
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
        await db.run(
          `UPDATE products SET stock=stock+?, updated_at=datetime('now') WHERE id=?`,
          [item.quantity, item.product_id],
        );
        // FIX: enqueue stock restoration so other devices update
        const prod = (
          await db.query(`SELECT * FROM products WHERE id=?`, [item.product_id])
        ).values?.[0];
        if (prod)
          await enqueue(
            "products",
            "update",
            prod.id,
            strip(prod, PRODUCT_JOIN),
          );
      }
      await db.run(
        `UPDATE order_items SET _deleted=1, updated_at=datetime('now') WHERE order_id=?`,
        [id],
      );
      await db.run(
        `UPDATE orders SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("orders", "delete", id);
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
        await db.run(
          `UPDATE dues SET customer_id=?, order_id=?, amount=?, currency=?, amount_sp=?, description=?, due_date=?, updated_at=datetime('now') WHERE id=?`,
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
        await enqueue("dues", "update", due.id, {
          ...cleanDue,
          amount_sp: amountSp,
        });
        return { ok: true, id: due.id };
      } else {
        const r = await db.run(
          `INSERT INTO dues (customer_id, order_id, amount, currency, amount_sp, description, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            cleanDue.customer_id,
            cleanDue.order_id,
            cleanDue.amount,
            cleanDue.currency,
            amountSp,
            cleanDue.description,
            cleanDue.due_date,
          ],
        );
        const id = r.changes?.lastId;
        await enqueue("dues", "insert", id, {
          ...cleanDue,
          id,
          amount_sp: amountSp,
        });
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // FIX: fetch full row after update so updated_at is included in payload
  // Without updated_at in the payload, server upsert won't update updated_at
  // → desktop pull (WHERE updated_at > since) never sees the change
  const markDuePaid = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE dues SET paid=1, paid_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      const full = (await db.query(`SELECT * FROM dues WHERE id=?`, [id]))
        .values?.[0];
      await enqueue(
        "dues",
        "update",
        id,
        strip(full, DUE_JOIN) ?? { id, paid: 1 },
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteDue = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(
        `UPDATE dues SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
        [id],
      );
      await enqueue("dues", "delete", id);
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
      const data =
        (
          await db.query(
            `SELECT id, full_name, username, role, phone, email, is_active, created_at FROM staff WHERE _deleted=0 AND (full_name LIKE ? OR username LIKE ?) ORDER BY full_name`,
            [like, like],
          )
        ).values ?? [];
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const saveStaff = async (s) => {
    try {
      const db = await getMobileDb();
      if (s.id) {
        if (s.password) {
          await db.run(
            `UPDATE staff SET full_name=?, username=?, password=?, role=?, phone=?, email=?, is_active=?, updated_at=datetime('now') WHERE id=?`,
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
        } else {
          await db.run(
            `UPDATE staff SET full_name=?, username=?, role=?, phone=?, email=?, is_active=?, updated_at=datetime('now') WHERE id=?`,
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
        }
        await enqueue("staff", "update", s.id, { ...s, password: undefined });
        return { ok: true, id: s.id };
      } else {
        const r = await db.run(
          `INSERT INTO staff (full_name, username, password, role, phone, email, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            s.full_name,
            s.username,
            s.password,
            s.role,
            s.phone,
            s.email,
            s.is_active,
          ],
        );
        const id = r.changes?.lastId;
        await enqueue("staff", "insert", id, { ...s, id, password: undefined });
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const deleteStaff = async (id) => {
    try {
      const db = await getMobileDb();
      await db.run(`UPDATE staff SET _deleted=1 WHERE id=?`, [id]);
      await enqueue("staff", "delete", id);
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
            `SELECT date(order_date) as day, SUM(total_sp) as total_sp, COUNT(*) as orders, SUM(CASE WHEN status='paid' THEN total_sp ELSE 0 END) as paid_sp, SUM(CASE WHEN status!='paid' THEN total_sp ELSE 0 END) as unpaid_sp FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ? GROUP BY day ORDER BY day`,
            [f, t],
          )
        ).values ?? []
      ).map((row) => ({
        ...row,
        total: row.total_sp / divisor,
        paid: row.paid_sp / divisor,
        unpaid: row.unpaid_sp / divisor,
      }));
      const byStatus =
        (
          await db.query(
            `SELECT status, COUNT(*) as count, SUM(total_sp) as total_sp FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ? GROUP BY status`,
            [f, t],
          )
        ).values ?? [];
      const topProducts = (
        (
          await db.query(
            `SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.line_total_sp) as total_sp FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE oi._deleted=0 AND o._deleted=0 AND date(o.order_date) BETWEEN ? AND ? GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10`,
            [f, t],
          )
        ).values ?? []
      ).map((row) => ({ ...row, total: row.total_sp / divisor }));
      const totals =
        (
          await db.query(
            `SELECT COALESCE(SUM(total_sp),0) as revenue_sp, COUNT(*) as orders, COALESCE(SUM(CASE WHEN status='paid' THEN total_sp ELSE 0 END),0) as paid_sp, COALESCE(SUM(CASE WHEN status!='paid' THEN total_sp ELSE 0 END),0) as unpaid_sp FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ?`,
            [f, t],
          )
        ).values?.[0] ?? {};
      return {
        ok: true,
        data: {
          daily,
          byStatus,
          topProducts,
          reportCurrency,
          totals: {
            revenue: totals.revenue_sp / divisor,
            orders: totals.orders,
            paid: totals.paid_sp / divisor,
            unpaid: totals.unpaid_sp / divisor,
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
      const result = await db.query(`SELECT key, value FROM settings`);
      const data = Object.fromEntries(
        (result.values ?? []).map((r) => [r.key, r.value]),
      );
      return { ok: true, data };
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
      const data =
        (
          await db.query(
            `SELECT * FROM sync_queue WHERE synced_at IS NULL AND (retry_count IS NULL OR retry_count < 5) ORDER BY id ASC LIMIT 500`,
          )
        ).values ?? [];
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  const markSynced = async (ids) => {
    try {
      if (!ids?.length) return { ok: true };
      const db = await getMobileDb();
      const placeholders = ids.map(() => "?").join(",");
      await db.run(
        `UPDATE sync_queue SET synced_at=datetime('now') WHERE id IN (${placeholders})`,
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
      const r = (
        await db.query(`SELECT value FROM sync_meta WHERE key='last_synced_at'`)
      ).values?.[0];
      return { ok: true, data: r?.value ?? null };
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

  // FIX: properly quoted column names, safe updated_at check, handles all tables
  const applyRemoteRow = async ({ table, row }) => {
    try {
      const db = await getMobileDb();
      const ALLOWED = new Set([
        "categories",
        "products",
        "customers",
        "orders",
        "order_items",
        "dues",
        "staff",
      ]);
      if (!ALLOWED.has(table))
        return { ok: false, error: `Unknown table: ${table}` };

      const normalized = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === "synced_at") continue;
        if (typeof v === "boolean") normalized[k] = v ? 1 : 0;
        else if (k === "id" || k.endsWith("_id"))
          normalized[k] = v !== null ? Number(v) : null;
        else normalized[k] = v;
      }
      if (!("id" in normalized)) return { ok: false, error: "Missing row.id" };

      // Skip if local row is newer
      try {
        const existing = (
          await db.query(`SELECT updated_at FROM "${table}" WHERE id=?`, [
            normalized.id,
          ])
        ).values?.[0];
        if (existing?.updated_at && normalized.updated_at) {
          if (
            new Date(existing.updated_at) >= new Date(normalized.updated_at)
          ) {
            return { ok: true, skipped: true };
          }
        }
      } catch {
        /* table may not exist yet — proceed */
      }

      const cols = Object.keys(normalized);
      const placeholders = cols.map(() => "?").join(", ");
      const vals = cols.map((c) => normalized[c]);

      await db.run(
        `INSERT OR REPLACE INTO "${table}" (${cols
          .map((c) => `"${c}"`)
          .join(", ")}) VALUES (${placeholders})`,
        vals,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // ── FETCH DOLLAR RATE ─────────────────────────────────────────────────────
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
