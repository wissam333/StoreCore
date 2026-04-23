// store-app/ipc/store.js
// Register all store IPC handlers.
// Call registerStoreHandlers(db, ipcMain) from main.js after DB is ready.

export function registerStoreHandlers(db, ipcMain) {
  const ALLOWED_TABLES = new Set([
    "categories",
    "products",
    "customers",
    "orders",
    "order_items",
    "dues",
    "staff",
  ]);

  // ── Strip JOIN-computed fields before enqueueing ───────────────────────────
  const PRODUCT_JOIN = new Set(["category_name"]);
  const ORDER_JOIN = new Set(["customer_name", "customer_phone", "item_count"]);
  const DUE_JOIN = new Set(["customer_name", "customer_phone"]);
  const ITEM_JOIN = new Set(["current_stock"]);

  const strip = (obj, fieldSet) => {
    if (!obj || !fieldSet.size) return obj;
    const copy = { ...obj };
    for (const f of fieldSet) delete copy[f];
    return copy;
  };

  // ── Helper: enqueue sync item ──────────────────────────────────────────────
  const enqueue = (table, operation, rowId, payload = null) => {
    db.prepare(
      `INSERT INTO sync_queue (table_name, operation, row_id, payload) VALUES (?, ?, ?, ?)`,
    ).run(table, operation, rowId, payload ? JSON.stringify(payload) : null);
  };

  // ── Helper: get dollar rate from settings ──────────────────────────────────
  const getDollarRate = () => {
    const row = db
      .prepare(`SELECT value FROM settings WHERE key='dollar_rate'`)
      .get();
    return parseFloat(row?.value ?? "15000") || 15000;
  };

  const toSP = (amount, currency) => {
    if (currency === "USD") return amount * getDollarRate();
    return amount;
  };

  const deriveStatus = (totalSp, paidAmount, displayCurrency) => {
    const rate = getDollarRate();
    const paidSp = displayCurrency === "USD" ? paidAmount * rate : paidAmount;
    if (paidSp <= 0) return "pending";
    if (paidSp >= totalSp - 0.001) return "paid";
    return "partly_paid";
  };

  // ── STATS ──────────────────────────────────────────────────────────────────
  ipcMain.handle("store:getStats", () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const firstOfMonth = today.slice(0, 7) + "-01";
      const rate = getDollarRate();
      const reportCurrency =
        db
          .prepare(`SELECT value FROM settings WHERE key='report_currency'`)
          .get()?.value ?? "SP";
      const totalProducts = db
        .prepare(
          `SELECT COUNT(*) as n FROM products WHERE _deleted=0 AND is_active=1`,
        )
        .get().n;
      const totalCustomers = db
        .prepare(`SELECT COUNT(*) as n FROM customers WHERE _deleted=0`)
        .get().n;
      const lowStock = db
        .prepare(
          `SELECT COUNT(*) as n FROM products WHERE _deleted=0 AND stock <= min_stock AND min_stock > 0`,
        )
        .get().n;
      const todayOrders = db
        .prepare(
          `SELECT COUNT(*) as n FROM orders WHERE date(order_date)=? AND _deleted=0`,
        )
        .get(today).n;
      const monthRevSP = db
        .prepare(
          `SELECT COALESCE(SUM(total_sp), 0) as n FROM orders WHERE status='paid' AND _deleted=0 AND order_date >= ?`,
        )
        .get(firstOfMonth).n;
      const unpaidDues = db
        .prepare(`SELECT COUNT(*) as n FROM dues WHERE paid=0 AND _deleted=0`)
        .get().n;
      const unpaidDuesAmount = db
        .prepare(
          `SELECT COALESCE(SUM(amount_sp),0) as n FROM dues WHERE paid=0 AND _deleted=0`,
        )
        .get().n;
      const monthRev =
        reportCurrency === "USD" ? monthRevSP / rate : monthRevSP;
      const duesDisplay =
        reportCurrency === "USD" ? unpaidDuesAmount / rate : unpaidDuesAmount;
      return {
        ok: true,
        data: {
          totalProducts,
          totalCustomers,
          lowStock,
          todayOrders,
          monthRevenue: monthRev,
          reportCurrency,
          unpaidDues,
          unpaidDuesAmount: duesDisplay,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── CATEGORIES ─────────────────────────────────────────────────────────────
  ipcMain.handle("store:getCategories", () => {
    try {
      const data = db
        .prepare(`SELECT * FROM categories WHERE _deleted=0 ORDER BY name`)
        .all();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:saveCategory", (_, cat) => {
    try {
      if (cat.id) {
        db.prepare(
          `UPDATE categories SET name=@name, description=@description, updated_at=datetime('now') WHERE id=@id`,
        ).run(cat);
        enqueue("categories", "update", cat.id, cat);
        return { ok: true, id: cat.id };
      } else {
        const r = db
          .prepare(
            `INSERT INTO categories (name, description) VALUES (@name, @description)`,
          )
          .run(cat);
        enqueue("categories", "insert", r.lastInsertRowid, {
          ...cat,
          id: r.lastInsertRowid,
        });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteCategory", (_, id) => {
    try {
      db.prepare(
        `UPDATE categories SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("categories", "delete", id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── PRODUCTS ───────────────────────────────────────────────────────────────
  ipcMain.handle(
    "store:getProducts",
    (
      _,
      {
        search = "",
        categoryId,
        limit = 50,
        offset = 0,
        activeOnly = false,
      } = {},
    ) => {
      try {
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
        const data = db
          .prepare(
            `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE ${where} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
          )
          .all(...params, limit, offset);
        const total = db
          .prepare(`SELECT COUNT(*) as n FROM products p WHERE ${where}`)
          .get(...params).n;
        return { ok: true, data, total };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  ipcMain.handle("store:getProductById", (_, id) => {
    try {
      const data = db
        .prepare(
          `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=? AND p._deleted=0`,
        )
        .get(id);
      if (!data) return { ok: false, error: "Not found" };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:saveProduct", (_, p) => {
    try {
      const clean = strip(p, PRODUCT_JOIN);
      if (clean.id) {
        db.prepare(
          `UPDATE products SET name=@name, description=@description, category_id=@category_id, barcode=@barcode, buy_price=@buy_price, sell_price=@sell_price, currency=@currency, stock=@stock, min_stock=@min_stock, unit=@unit, image_url=@image_url, is_active=@is_active, updated_at=datetime('now') WHERE id=@id`,
        ).run(clean);
        enqueue("products", "update", clean.id, clean);
        return { ok: true, id: clean.id };
      } else {
        const r = db
          .prepare(
            `INSERT INTO products (name, description, category_id, barcode, buy_price, sell_price, currency, stock, min_stock, unit, image_url, is_active) VALUES (@name, @description, @category_id, @barcode, @buy_price, @sell_price, @currency, @stock, @min_stock, @unit, @image_url, @is_active)`,
          )
          .run(clean);
        enqueue("products", "insert", r.lastInsertRowid, {
          ...clean,
          id: r.lastInsertRowid,
        });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteProduct", (_, id) => {
    try {
      db.prepare(
        `UPDATE products SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("products", "delete", id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:adjustStock", (_, { id, delta }) => {
    try {
      db.prepare(
        `UPDATE products SET stock=MAX(0, stock + ?), updated_at=datetime('now') WHERE id=?`,
      ).run(delta, id);
      // FIX: send full row so updated_at propagates
      const full = db.prepare(`SELECT * FROM products WHERE id=?`).get(id);
      enqueue("products", "update", id, strip(full, PRODUCT_JOIN));
      return { ok: true, stock: full.stock };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── CUSTOMERS ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    "store:getCustomers",
    (_, { search = "", limit = 50, offset = 0 } = {}) => {
      try {
        const like = `%${search}%`;
        const data = db
          .prepare(
            `SELECT * FROM customers WHERE _deleted=0 AND (name LIKE ? OR phone LIKE ?) ORDER BY name ASC LIMIT ? OFFSET ?`,
          )
          .all(like, like, limit, offset);
        const total = db
          .prepare(
            `SELECT COUNT(*) as n FROM customers WHERE _deleted=0 AND (name LIKE ? OR phone LIKE ?)`,
          )
          .get(like, like).n;
        return { ok: true, data, total };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  ipcMain.handle("store:getCustomerById", (_, id) => {
    try {
      const customer = db
        .prepare(`SELECT * FROM customers WHERE id=? AND _deleted=0`)
        .get(id);
      if (!customer) return { ok: false, error: "Not found" };
      const orders = db
        .prepare(
          `SELECT * FROM orders WHERE customer_id=? AND _deleted=0 ORDER BY order_date DESC LIMIT 50`,
        )
        .all(id);
      const dues = db
        .prepare(
          `SELECT * FROM dues WHERE customer_id=? AND _deleted=0 ORDER BY created_at DESC`,
        )
        .all(id);
      return { ok: true, data: { ...customer, orders, dues } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:saveCustomer", (_, c) => {
    try {
      if (c.id) {
        db.prepare(
          `UPDATE customers SET name=@name, phone=@phone, address=@address, notes=@notes, updated_at=datetime('now') WHERE id=@id`,
        ).run(c);
        enqueue("customers", "update", c.id, c);
        return { ok: true, id: c.id };
      } else {
        const r = db
          .prepare(
            `INSERT INTO customers (name, phone, address, notes) VALUES (@name, @phone, @address, @notes)`,
          )
          .run(c);
        enqueue("customers", "insert", r.lastInsertRowid, {
          ...c,
          id: r.lastInsertRowid,
        });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteCustomer", (_, id) => {
    try {
      db.prepare(
        `UPDATE customers SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("customers", "delete", id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:findOrCreateCustomer", (_, name) => {
    try {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Name is required" };
      let customer = db
        .prepare(`SELECT * FROM customers WHERE name=? AND _deleted=0 LIMIT 1`)
        .get(trimmed);
      if (!customer) {
        const r = db
          .prepare(`INSERT INTO customers (name) VALUES (?)`)
          .run(trimmed);
        customer = db
          .prepare(`SELECT * FROM customers WHERE id=?`)
          .get(r.lastInsertRowid);
        enqueue("customers", "insert", r.lastInsertRowid, customer);
      }
      return { ok: true, data: customer };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── ORDERS ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    "store:getOrders",
    (
      _,
      {
        search = "",
        status,
        customerId,
        dateFrom,
        dateTo,
        limit = 50,
        offset = 0,
      } = {},
    ) => {
      try {
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
        const data = db
          .prepare(
            `SELECT o.*, c.name as customer_name, c.phone as customer_phone, (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND _deleted=0) as item_count FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE ${where} ORDER BY o.order_date DESC LIMIT ? OFFSET ?`,
          )
          .all(...params, limit, offset);
        const total = db
          .prepare(
            `SELECT COUNT(*) as n FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE ${where}`,
          )
          .get(...params).n;
        return { ok: true, data, total };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  ipcMain.handle("store:getOrderById", (_, id) => {
    try {
      const order = db
        .prepare(
          `SELECT o.*, c.name as customer_name, c.phone as customer_phone FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=? AND o._deleted=0`,
        )
        .get(id);
      if (!order) return { ok: false, error: "Not found" };
      order.items = db
        .prepare(
          `SELECT oi.*, p.stock as current_stock FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id WHERE oi.order_id=? AND oi._deleted=0`,
        )
        .all(id);
      return { ok: true, data: order };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:saveOrder", (_, { order, items }) => {
    try {
      const rate = getDollarRate();
      const saveOrderAndItems = db.transaction(() => {
        let orderId = order.id;
        let totalSp = 0;
        for (const item of items) {
          totalSp += toSP(
            item.sell_price_at_sale * item.quantity,
            item.currency_at_sale,
          );
        }
        const totalUsd = totalSp / rate;
        const status = deriveStatus(
          totalSp,
          order.paid_amount ?? 0,
          order.display_currency ?? "SP",
        );
        const cleanOrder = strip(order, ORDER_JOIN);

        if (orderId) {
          const oldItems = db
            .prepare(
              `SELECT * FROM order_items WHERE order_id=? AND _deleted=0`,
            )
            .all(orderId);
          for (const oi of oldItems) {
            db.prepare(
              `UPDATE products SET stock=stock+?, updated_at=datetime('now') WHERE id=?`,
            ).run(oi.quantity, oi.product_id);
          }
          db.prepare(
            `UPDATE order_items SET _deleted=1, updated_at=datetime('now') WHERE order_id=?`,
          ).run(orderId);
          db.prepare(
            `UPDATE orders SET customer_id=@customer_id, order_date=@order_date, status=@status, total_sp=@total_sp, total_usd=@total_usd, paid_amount=@paid_amount, display_currency=@display_currency, notes=@notes, updated_at=datetime('now') WHERE id=@id`,
          ).run({
            ...cleanOrder,
            status,
            total_sp: totalSp,
            total_usd: totalUsd,
            id: orderId,
          });
        } else {
          const r = db
            .prepare(
              `INSERT INTO orders (customer_id, order_date, status, total_sp, total_usd, paid_amount, display_currency, notes) VALUES (@customer_id, @order_date, @status, @total_sp, @total_usd, @paid_amount, @display_currency, @notes)`,
            )
            .run({
              ...cleanOrder,
              status,
              total_sp: totalSp,
              total_usd: totalUsd,
            });
          orderId = r.lastInsertRowid;
        }

        for (const item of items) {
          const lineSP = toSP(
            item.sell_price_at_sale * item.quantity,
            item.currency_at_sale,
          );
          db.prepare(
            `INSERT INTO order_items (order_id, product_id, product_name, quantity, sell_price_at_sale, currency_at_sale, line_total_sp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            orderId,
            item.product_id,
            item.product_name,
            item.quantity,
            item.sell_price_at_sale,
            item.currency_at_sale,
            lineSP,
          );
          if (item.product_id) {
            db.prepare(
              `UPDATE products SET stock=MAX(0, stock - ?), updated_at=datetime('now') WHERE id=?`,
            ).run(item.quantity, item.product_id);
          }
        }

        if (order.customer_id) {
          db.prepare(
            `UPDATE customers SET total_orders=(SELECT COUNT(*) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'), total_spent=(SELECT COALESCE(SUM(total_sp),0) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'), last_order=datetime('now'), updated_at=datetime('now') WHERE id=?`,
          ).run(order.customer_id, order.customer_id, order.customer_id);
        }

        if (status === "paid") {
          db.prepare(
            `UPDATE dues SET paid=1, paid_at=datetime('now'), updated_at=datetime('now') WHERE order_id=? AND paid=0`,
          ).run(orderId);
          // FIX: enqueue updated dues so mobile sees them
          const updatedDues = db
            .prepare(`SELECT * FROM dues WHERE order_id=? AND paid=1`)
            .all(orderId);
          for (const due of updatedDues)
            enqueue("dues", "update", due.id, strip(due, DUE_JOIN));
        }

        // Enqueue order
        enqueue("orders", order.id ? "update" : "insert", orderId, {
          ...cleanOrder,
          id: orderId,
          status,
          total_sp: totalSp,
          total_usd: totalUsd,
        });

        // FIX: enqueue all order_items so they sync to mobile
        const savedItems = db
          .prepare(`SELECT * FROM order_items WHERE order_id=? AND _deleted=0`)
          .all(orderId);
        for (const item of savedItems)
          enqueue("order_items", "insert", item.id, strip(item, ITEM_JOIN));

        // FIX: enqueue updated product stocks so mobile sees qty changes
        for (const item of items) {
          if (item.product_id) {
            const prod = db
              .prepare(`SELECT * FROM products WHERE id=?`)
              .get(item.product_id);
            if (prod)
              enqueue("products", "update", prod.id, strip(prod, PRODUCT_JOIN));
          }
        }

        return orderId;
      });

      const orderId = saveOrderAndItems();
      return { ok: true, id: orderId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(
    "store:updateOrderPayment",
    (_, { id, paid_amount, display_currency }) => {
      try {
        const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
        if (!order) return { ok: false, error: "Not found" };
        const status = deriveStatus(
          order.total_sp,
          paid_amount,
          display_currency,
        );
        db.prepare(
          `UPDATE orders SET paid_amount=?, display_currency=?, status=?, updated_at=datetime('now') WHERE id=?`,
        ).run(paid_amount, display_currency, status, id);

        if (status === "paid") {
          db.prepare(
            `UPDATE dues SET paid=1, paid_at=datetime('now'), updated_at=datetime('now') WHERE order_id=? AND paid=0`,
          ).run(id);
          // FIX: enqueue updated dues so mobile sees them
          const updatedDues = db
            .prepare(`SELECT * FROM dues WHERE order_id=? AND paid=1`)
            .all(id);
          for (const due of updatedDues)
            enqueue("dues", "update", due.id, strip(due, DUE_JOIN));
        }

        // FIX: send full order row so updated_at propagates
        const updated = db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
        enqueue("orders", "update", id, strip(updated, ORDER_JOIN));
        return { ok: true, status };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  ipcMain.handle("store:deleteOrder", (_, id) => {
    try {
      const restoreStock = db.transaction(() => {
        const items = db
          .prepare(`SELECT * FROM order_items WHERE order_id=? AND _deleted=0`)
          .all(id);
        for (const item of items) {
          db.prepare(
            `UPDATE products SET stock=stock+?, updated_at=datetime('now') WHERE id=?`,
          ).run(item.quantity, item.product_id);
          // FIX: enqueue stock restoration
          const prod = db
            .prepare(`SELECT * FROM products WHERE id=?`)
            .get(item.product_id);
          if (prod)
            enqueue("products", "update", prod.id, strip(prod, PRODUCT_JOIN));
        }
        db.prepare(
          `UPDATE order_items SET _deleted=1, updated_at=datetime('now') WHERE order_id=?`,
        ).run(id);
        db.prepare(
          `UPDATE orders SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
        ).run(id);
      });
      restoreStock();
      enqueue("orders", "delete", id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── DUES ───────────────────────────────────────────────────────────────────
  ipcMain.handle(
    "store:getDues",
    (
      _,
      { customerId, paid, dateFrom, dateTo, limit = 50, offset = 0 } = {},
    ) => {
      try {
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
        const data = db
          .prepare(
            `SELECT d.*, c.name as customer_name, c.phone as customer_phone FROM dues d LEFT JOIN customers c ON d.customer_id=c.id WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(...params, limit, offset);
        const total = db
          .prepare(`SELECT COUNT(*) as n FROM dues d WHERE ${where}`)
          .get(...params).n;
        const totalUnpaidSp = db
          .prepare(
            `SELECT COALESCE(SUM(amount_sp),0) as n FROM dues d WHERE d._deleted=0 AND d.paid=0${customerId ? " AND d.customer_id=" + customerId : ""}`,
          )
          .get().n;
        return { ok: true, data, total, totalUnpaidSp };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  ipcMain.handle("store:saveDue", (_, due) => {
    try {
      const amountSp = toSP(due.amount, due.currency);
      const cleanDue = strip(due, DUE_JOIN);
      if (due.id) {
        db.prepare(
          `UPDATE dues SET customer_id=@customer_id, order_id=@order_id, amount=@amount, currency=@currency, amount_sp=@amount_sp, description=@description, due_date=@due_date, updated_at=datetime('now') WHERE id=@id`,
        ).run({ ...cleanDue, amount_sp: amountSp });
        enqueue("dues", "update", due.id, { ...cleanDue, amount_sp: amountSp });
        return { ok: true, id: due.id };
      } else {
        const r = db
          .prepare(
            `INSERT INTO dues (customer_id, order_id, amount, currency, amount_sp, description, due_date) VALUES (@customer_id, @order_id, @amount, @currency, @amount_sp, @description, @due_date)`,
          )
          .run({ ...cleanDue, amount_sp: amountSp });
        enqueue("dues", "insert", r.lastInsertRowid, {
          ...cleanDue,
          id: r.lastInsertRowid,
          amount_sp: amountSp,
        });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // FIX: send full row so updated_at is in payload → server sets updated_at=NOW()
  // → other device pull query (WHERE updated_at > since) picks it up
  ipcMain.handle("store:markDuePaid", (_, id) => {
    try {
      db.prepare(
        `UPDATE dues SET paid=1, paid_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      const full = db.prepare(`SELECT * FROM dues WHERE id=?`).get(id);
      enqueue("dues", "update", id, strip(full, DUE_JOIN) ?? { id, paid: 1 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteDue", (_, id) => {
    try {
      db.prepare(
        `UPDATE dues SET _deleted=1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("dues", "delete", id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── STAFF ──────────────────────────────────────────────────────────────────
  ipcMain.handle("store:getStaff", (_, { search = "" } = {}) => {
    try {
      const like = `%${search}%`;
      const data = db
        .prepare(
          `SELECT id, full_name, username, role, phone, email, is_active, created_at FROM staff WHERE _deleted=0 AND (full_name LIKE ? OR username LIKE ?) ORDER BY full_name`,
        )
        .all(like, like);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:saveStaff", (_, s) => {
    try {
      if (s.id) {
        if (s.password) {
          db.prepare(
            `UPDATE staff SET full_name=@full_name, username=@username, password=@password, role=@role, phone=@phone, email=@email, is_active=@is_active, updated_at=datetime('now') WHERE id=@id`,
          ).run(s);
        } else {
          db.prepare(
            `UPDATE staff SET full_name=@full_name, username=@username, role=@role, phone=@phone, email=@email, is_active=@is_active, updated_at=datetime('now') WHERE id=@id`,
          ).run(s);
        }
        enqueue("staff", "update", s.id, { ...s, password: undefined });
        return { ok: true, id: s.id };
      } else {
        const r = db
          .prepare(
            `INSERT INTO staff (full_name, username, password, role, phone, email, is_active) VALUES (@full_name, @username, @password, @role, @phone, @email, @is_active)`,
          )
          .run(s);
        enqueue("staff", "insert", r.lastInsertRowid, {
          ...s,
          id: r.lastInsertRowid,
          password: undefined,
        });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteStaff", (_, id) => {
    try {
      db.prepare(`UPDATE staff SET _deleted=1 WHERE id=?`).run(id);
      enqueue("staff", "delete", id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── REPORTS ────────────────────────────────────────────────────────────────
  ipcMain.handle("store:getRevenueReport", (_, { dateFrom, dateTo } = {}) => {
    try {
      const f = dateFrom || "2000-01-01";
      const t = dateTo || "2099-12-31";
      const rate = getDollarRate();
      const reportCurrency =
        db
          .prepare(`SELECT value FROM settings WHERE key='report_currency'`)
          .get()?.value ?? "SP";
      const daily = db
        .prepare(
          `SELECT date(order_date) as day, SUM(total_sp) as total_sp, COUNT(*) as orders, SUM(CASE WHEN status='paid' THEN total_sp ELSE 0 END) as paid_sp, SUM(CASE WHEN status!='paid' THEN total_sp ELSE 0 END) as unpaid_sp FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ? GROUP BY day ORDER BY day`,
        )
        .all(f, t)
        .map((row) => ({
          ...row,
          total: reportCurrency === "USD" ? row.total_sp / rate : row.total_sp,
          paid: reportCurrency === "USD" ? row.paid_sp / rate : row.paid_sp,
          unpaid:
            reportCurrency === "USD" ? row.unpaid_sp / rate : row.unpaid_sp,
        }));
      const byStatus = db
        .prepare(
          `SELECT status, COUNT(*) as count, SUM(total_sp) as total_sp FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ? GROUP BY status`,
        )
        .all(f, t);
      const topProducts = db
        .prepare(
          `SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.line_total_sp) as total_sp FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE oi._deleted=0 AND o._deleted=0 AND date(o.order_date) BETWEEN ? AND ? GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10`,
        )
        .all(f, t)
        .map((row) => ({
          ...row,
          total: reportCurrency === "USD" ? row.total_sp / rate : row.total_sp,
        }));
      const totals = db
        .prepare(
          `SELECT COALESCE(SUM(total_sp), 0) as revenue_sp, COUNT(*) as orders, COALESCE(SUM(CASE WHEN status='paid' THEN total_sp ELSE 0 END), 0) as paid_sp, COALESCE(SUM(CASE WHEN status!='paid' THEN total_sp ELSE 0 END), 0) as unpaid_sp FROM orders WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ?`,
        )
        .get(f, t);
      const divisor = reportCurrency === "USD" ? rate : 1;
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
  });

  ipcMain.handle("store:getDuesReport", (_, { dateFrom, dateTo } = {}) => {
    try {
      const f = dateFrom || "2000-01-01";
      const t = dateTo || "2099-12-31";
      const rate = getDollarRate();
      const reportCurrency =
        db
          .prepare(`SELECT value FROM settings WHERE key='report_currency'`)
          .get()?.value ?? "SP";
      const divisor = reportCurrency === "USD" ? rate : 1;
      const summary = db
        .prepare(
          `SELECT COUNT(*) as total_dues, COALESCE(SUM(CASE WHEN paid=0 THEN amount_sp ELSE 0 END), 0) as unpaid_sp, COALESCE(SUM(CASE WHEN paid=1 THEN amount_sp ELSE 0 END), 0) as paid_sp, COUNT(CASE WHEN paid=0 THEN 1 END) as unpaid_count, COUNT(CASE WHEN paid=1 THEN 1 END) as paid_count FROM dues WHERE _deleted=0 AND date(created_at) BETWEEN ? AND ?`,
        )
        .get(f, t);
      const topDebtors = db
        .prepare(
          `SELECT c.name, c.phone, COALESCE(SUM(d.amount_sp),0) as total_sp FROM dues d JOIN customers c ON d.customer_id=c.id WHERE d._deleted=0 AND d.paid=0 GROUP BY d.customer_id ORDER BY total_sp DESC LIMIT 10`,
        )
        .all()
        .map((r) => ({ ...r, total: r.total_sp / divisor }));
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
  });

  // ── SETTINGS ───────────────────────────────────────────────────────────────
  ipcMain.handle("store:getSettings", () => {
    try {
      const rows = db.prepare(`SELECT key, value FROM settings`).all();
      return {
        ok: true,
        data: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:setSetting", (_, { key, value }) => {
    try {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      ).run(key, value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:fetchDollarRate", async () => {
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
        const res = await fetch(source.url, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) continue;
        const json = await res.json();
        const result = source.extract(json);
        if (result?.rate && result.rate > 100) return { ok: true, ...result };
      } catch {
        /* try next */
      }
    }
    return { ok: false, error: "Could not fetch rate from any source" };
  });

  // ── SYNC ───────────────────────────────────────────────────────────────────
  ipcMain.handle("store:getSyncQueue", () => {
    try {
      const data = db
        .prepare(
          `SELECT * FROM sync_queue WHERE synced_at IS NULL AND (retry_count IS NULL OR retry_count < 5) ORDER BY id ASC LIMIT 500`,
        )
        .all();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:markSynced", (_, ids) => {
    try {
      if (!ids?.length) return { ok: true };
      const placeholders = ids.map(() => "?").join(",");
      db.prepare(
        `UPDATE sync_queue SET synced_at=datetime('now') WHERE id IN (${placeholders})`,
      ).run(...ids);
      db.prepare(
        `UPDATE sync_meta SET value=datetime('now') WHERE key='last_synced_at'`,
      ).run();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:getLastSyncedAt", () => {
    try {
      const r = db
        .prepare(`SELECT value FROM sync_meta WHERE key='last_synced_at'`)
        .get();
      return { ok: true, data: r?.value ?? null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:setLastSyncedAt", (_, iso) => {
    try {
      db.prepare(
        `INSERT INTO sync_meta (key, value) VALUES ('last_synced_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).run(iso);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:applyRemoteRow", (_, { table, row }) => {
    try {
      if (!ALLOWED_TABLES.has(table))
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
      const existing = db
        .prepare(`SELECT updated_at FROM "${table}" WHERE id=?`)
        .get(normalized.id);
      if (existing?.updated_at && normalized.updated_at) {
        if (new Date(existing.updated_at) >= new Date(normalized.updated_at))
          return { ok: true, skipped: true };
      }
      const cols = Object.keys(normalized);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const placeholders = cols.map(() => "?").join(", ");
      const vals = cols.map((c) => normalized[c]);
      db.prepare("PRAGMA foreign_keys = OFF").run();
      try {
        db.prepare(
          `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`,
        ).run(...vals);
      } finally {
        db.prepare("PRAGMA foreign_keys = ON").run();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("native-fetch", async (event, url) => {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      return await response.text();
    } catch (error) {
      console.error("Electron Fetch Error:", error);
      throw error;
    }
  });
}
