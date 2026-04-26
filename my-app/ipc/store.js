// store-app/ipc/store.js
// Register all store IPC handlers.
// Call registerStoreHandlers(db, ipcMain) from main.js after DB is ready.
//
// SYNC UPGRADE: Field-level change tracking.
// Every enqueue() call now records which fields actually changed (changedFields).
// The sync push sends PATCH + _changed_fields so the server can merge
// concurrent edits to different columns of the same row without data loss.
// e.g. User A edits product.name, User B edits product.stock → both survive.

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

  const fk = (v) => (v === undefined || v === null || v === "" ? null : v);

  // ── UUID generator (Node 19+ has crypto.randomUUID globally) ─────────────
  const uuid = () => crypto.randomUUID();

  // ── Strip JOIN-computed fields before enqueueing ──────────────────────────
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

  // ── Editable field lists per table (used for changedFields diffing) ───────
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

  // ── Diff two rows, return array of field names that changed ───────────────
  const diffFields = (table, before, after) => {
    const fields = EDITABLE_FIELDS[table] ?? [];
    if (!before) return fields; // insert — all fields are "new"
    return fields.filter(
      (f) => String(before[f] ?? "") !== String(after[f] ?? ""),
    );
  };

  // ── Helper: enqueue sync item (now includes changedFields) ────────────────
  const enqueue = (
    table,
    operation,
    rowId,
    payload = null,
    changedFields = null,
  ) => {
    db.prepare(
      `INSERT INTO sync_queue (table_name, operation, row_id, payload, changed_fields)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      table,
      operation,
      rowId,
      payload ? JSON.stringify(payload) : null,
      changedFields ? JSON.stringify(changedFields) : null,
    );
  };

  // ── Helper: read back a freshly-written row ───────────────────────────────
  const freshRow = (table, id) =>
    db.prepare(`SELECT * FROM "${table}" WHERE id=?`).get(id) ?? null;

  // ── Helper: dollar rate ───────────────────────────────────────────────────
  const getDollarRate = () => {
    const row = db
      .prepare(`SELECT value FROM settings WHERE key='dollar_rate'`)
      .get();
    return parseFloat(row?.value ?? "15000") || 15000;
  };

  const toSP = (amount, currency) =>
    currency === "USD" ? amount * getDollarRate() : amount;

  const deriveStatus = (totalSp, paidAmount, displayCurrency) => {
    const rate = getDollarRate();
    const paidSp = displayCurrency === "USD" ? paidAmount * rate : paidAmount;
    if (paidSp <= 0) return "pending";
    if (paidSp >= totalSp - 0.001) return "paid";
    return "partly_paid";
  };

  // ── STATS ─────────────────────────────────────────────────────────────────
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
  });

  // ── CATEGORIES ────────────────────────────────────────────────────────────
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
        const before = freshRow("categories", cat.id);
        db.prepare(
          `UPDATE categories
           SET name=@name, description=@description,
               version=version+1, updated_at=datetime('now')
           WHERE id=@id`,
        ).run(cat);
        const fresh = freshRow("categories", cat.id);
        const changedFields = diffFields("categories", before, fresh);
        enqueue("categories", "update", cat.id, fresh, changedFields);
        return { ok: true, id: cat.id };
      } else {
        const id = uuid();
        db.prepare(
          `INSERT INTO categories (id, name, description) VALUES (?, ?, ?)`,
        ).run(id, cat.name, cat.description);
        const fresh = freshRow("categories", id);
        enqueue("categories", "insert", id, fresh, null);
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteCategory", (_, id) => {
    try {
      db.prepare(
        `UPDATE categories SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("categories", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── PRODUCTS ──────────────────────────────────────────────────────────────
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
            `SELECT p.*, c.name as category_name
             FROM products p
             LEFT JOIN categories c ON p.category_id=c.id
             WHERE ${where} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
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
          `SELECT p.*, c.name as category_name
           FROM products p
           LEFT JOIN categories c ON p.category_id=c.id
           WHERE p.id=? AND p._deleted=0`,
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
        const before = freshRow("products", clean.id);
        db.prepare(
          `UPDATE products
           SET name=@name, description=@description, category_id=@category_id,
               barcode=@barcode, buy_price=@buy_price, sell_price=@sell_price,
               currency=@currency, stock=@stock, min_stock=@min_stock,
               unit=@unit, image_url=@image_url, is_active=@is_active,
               version=version+1, updated_at=datetime('now')
           WHERE id=@id`,
        ).run(clean);
        const fresh = freshRow("products", clean.id);
        const changedFields = diffFields("products", before, fresh);
        enqueue(
          "products",
          "update",
          clean.id,
          strip(fresh, PRODUCT_JOIN),
          changedFields,
        );
        return { ok: true, id: clean.id };
      } else {
        const id = uuid();
        db.prepare(
          `INSERT INTO products
             (id, name, description, category_id, barcode, buy_price, sell_price,
              currency, stock, min_stock, unit, image_url, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
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
        );
        const fresh = freshRow("products", id);
        enqueue("products", "insert", id, strip(fresh, PRODUCT_JOIN), null);
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteProduct", (_, id) => {
    try {
      db.prepare(
        `UPDATE products SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("products", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:adjustStock", (_, { id, delta }) => {
    try {
      db.prepare(
        `UPDATE products
         SET stock=MAX(0, stock + ?), version=version+1, updated_at=datetime('now')
         WHERE id=?`,
      ).run(delta, id);
      const fresh = freshRow("products", id);
      // Only stock changed — be precise so other fields aren't stomped
      enqueue("products", "update", id, strip(fresh, PRODUCT_JOIN), ["stock"]);
      return { ok: true, stock: fresh?.stock };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── CUSTOMERS ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    "store:getCustomers",
    (_, { search = "", limit = 50, offset = 0 } = {}) => {
      try {
        const like = `%${search}%`;
        const data = db
          .prepare(
            `SELECT * FROM customers
             WHERE _deleted=0 AND (name LIKE ? OR phone LIKE ?)
             ORDER BY name ASC LIMIT ? OFFSET ?`,
          )
          .all(like, like, limit, offset);
        const total = db
          .prepare(
            `SELECT COUNT(*) as n FROM customers
             WHERE _deleted=0 AND (name LIKE ? OR phone LIKE ?)`,
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
          `SELECT * FROM orders
           WHERE customer_id=? AND _deleted=0
           ORDER BY order_date DESC LIMIT 50`,
        )
        .all(id);
      const dues = db
        .prepare(
          `SELECT * FROM dues
           WHERE customer_id=? AND _deleted=0
           ORDER BY created_at DESC`,
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
        const before = freshRow("customers", c.id);
        db.prepare(
          `UPDATE customers
           SET name=@name, phone=@phone, address=@address, notes=@notes,
               version=version+1, updated_at=datetime('now')
           WHERE id=@id`,
        ).run(c);
        const fresh = freshRow("customers", c.id);
        const changedFields = diffFields("customers", before, fresh);
        enqueue("customers", "update", c.id, fresh, changedFields);
        return { ok: true, id: c.id };
      } else {
        const id = uuid();
        db.prepare(
          `INSERT INTO customers (id, name, phone, address, notes) VALUES (?, ?, ?, ?, ?)`,
        ).run(id, c.name, c.phone, c.address, c.notes);
        const fresh = freshRow("customers", id);
        enqueue("customers", "insert", id, fresh, null);
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteCustomer", (_, id) => {
    try {
      db.prepare(
        `UPDATE customers SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("customers", "delete", id, null, null);
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
        const id = uuid();
        db.prepare(`INSERT INTO customers (id, name) VALUES (?, ?)`).run(
          id,
          trimmed,
        );
        customer = freshRow("customers", id);
        enqueue("customers", "insert", id, customer, null);
      }
      return { ok: true, data: customer };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── ORDERS ────────────────────────────────────────────────────────────────
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
          where += " AND (c.name LIKE ? OR o.id LIKE ?)";
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
            `SELECT o.*, c.name as customer_name, c.phone as customer_phone,
                    (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND _deleted=0) as item_count
             FROM orders o
             LEFT JOIN customers c ON o.customer_id=c.id
             WHERE ${where} ORDER BY o.order_date DESC LIMIT ? OFFSET ?`,
          )
          .all(...params, limit, offset);
        const total = db
          .prepare(
            `SELECT COUNT(*) as n FROM orders o
             LEFT JOIN customers c ON o.customer_id=c.id
             WHERE ${where}`,
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
          `SELECT o.*, c.name as customer_name, c.phone as customer_phone
           FROM orders o
           LEFT JOIN customers c ON o.customer_id=c.id
           WHERE o.id=? AND o._deleted=0`,
        )
        .get(id);
      if (!order) return { ok: false, error: "Not found" };
      order.items = db
        .prepare(
          `SELECT oi.*, p.stock as current_stock
           FROM order_items oi
           LEFT JOIN products p ON oi.product_id=p.id
           WHERE oi.order_id=? AND oi._deleted=0`,
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
        for (const item of items)
          totalSp += toSP(
            item.sell_price_at_sale * item.quantity,
            item.currency_at_sale,
          );
        const totalUsd = totalSp / rate;
        const status = deriveStatus(
          totalSp,
          order.paid_amount ?? 0,
          order.display_currency ?? "SP",
        );
        const cleanOrder = strip(order, ORDER_JOIN);

        if (orderId) {
          // ── EDIT PATH ─────────────────────────────────────────────────────
          const orderBefore = freshRow("orders", orderId);
          const oldItems = db
            .prepare(
              `SELECT * FROM order_items WHERE order_id=? AND _deleted=0`,
            )
            .all(orderId);

          // Restore stock from old items
          for (const oi of oldItems) {
            if (oi.product_id)
              db.prepare(
                `UPDATE products SET stock=stock+?, version=version+1, updated_at=datetime('now') WHERE id=?`,
              ).run(oi.quantity, oi.product_id);
          }

          // Soft-delete old items
          for (const oi of oldItems) {
            db.prepare(
              `UPDATE order_items SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
            ).run(oi.id);
            enqueue("order_items", "delete", oi.id, null, null);
          }

          // Update order row
          db.prepare(
            `UPDATE orders
             SET customer_id=@customer_id, order_date=@order_date, status=@status,
                 total_sp=@total_sp, total_usd=@total_usd, paid_amount=@paid_amount,
                 display_currency=@display_currency, notes=@notes,
                 version=version+1, updated_at=datetime('now')
             WHERE id=@id`,
          ).run({
            ...cleanOrder,
            status,
            total_sp: totalSp,
            total_usd: totalUsd,
            id: orderId,
          });

          const freshOrder = freshRow("orders", orderId);
          const orderChanged = diffFields("orders", orderBefore, freshOrder);
          enqueue(
            "orders",
            "update",
            orderId,
            strip(freshOrder, ORDER_JOIN),
            orderChanged,
          );
        } else {
          // ── INSERT PATH ───────────────────────────────────────────────────
          orderId = uuid();
          db.prepare(
            `INSERT INTO orders
               (id, customer_id, order_date, status, total_sp, total_usd,
                paid_amount, display_currency, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            orderId,
            cleanOrder.customer_id,
            cleanOrder.order_date ?? new Date().toISOString(),
            status,
            totalSp,
            totalUsd,
            cleanOrder.paid_amount ?? 0,
            cleanOrder.display_currency ?? "SP",
            cleanOrder.notes,
          );
          const freshOrder = freshRow("orders", orderId);
          enqueue(
            "orders",
            "insert",
            orderId,
            strip(freshOrder, ORDER_JOIN),
            null,
          );
        }

        // Insert new items + decrease stock
        const affectedProductIds = new Set();
        for (const item of items) {
          const lineSP = toSP(
            item.sell_price_at_sale * item.quantity,
            item.currency_at_sale,
          );
          const itemId = uuid();
          db.prepare(
            `INSERT INTO order_items
               (id, order_id, product_id, product_name, quantity,
                sell_price_at_sale, currency_at_sale, line_total_sp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            itemId,
            orderId,
            fk(item.product_id),
            item.product_name,
            item.quantity,
            item.sell_price_at_sale,
            item.currency_at_sale,
            lineSP,
          );
          if (item.product_id) {
            db.prepare(
              `UPDATE products SET stock=MAX(0, stock - ?), version=version+1, updated_at=datetime('now') WHERE id=?`,
            ).run(item.quantity, item.product_id);
            affectedProductIds.add(item.product_id);
          }
          const freshItem = freshRow("order_items", itemId);
          if (freshItem)
            enqueue(
              "order_items",
              "insert",
              itemId,
              strip(freshItem, ITEM_JOIN),
              null,
            );
        }

        // Update customer stats
        if (order.customer_id) {
          const custBefore = freshRow("customers", order.customer_id);
          db.prepare(
            `UPDATE customers
             SET total_orders=(SELECT COUNT(*) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'),
                 total_spent =(SELECT COALESCE(SUM(total_sp),0) FROM orders WHERE customer_id=? AND _deleted=0 AND status='paid'),
                 last_order  =datetime('now'),
                 version     =version+1,
                 updated_at  =datetime('now')
             WHERE id=?`,
          ).run(order.customer_id, order.customer_id, order.customer_id);
          const freshCust = freshRow("customers", order.customer_id);
          const custChanged = diffFields("customers", custBefore, freshCust);
          if (freshCust)
            enqueue(
              "customers",
              "update",
              order.customer_id,
              freshCust,
              custChanged,
            );
        }

        // Auto-pay linked dues
        if (status === "paid") {
          db.prepare(
            `UPDATE dues SET paid=1, paid_at=datetime('now'), version=version+1, updated_at=datetime('now')
             WHERE order_id=? AND paid=0`,
          ).run(orderId);
          const updatedDues = db
            .prepare(`SELECT * FROM dues WHERE order_id=? AND paid=1`)
            .all(orderId);
          for (const due of updatedDues)
            enqueue("dues", "update", due.id, strip(due, DUE_JOIN), [
              "paid",
              "paid_at",
            ]);
        }

        // Enqueue affected product stocks
        for (const pid of affectedProductIds) {
          const prod = freshRow("products", pid);
          if (prod)
            enqueue("products", "update", pid, strip(prod, PRODUCT_JOIN), [
              "stock",
            ]);
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
          `UPDATE orders
           SET paid_amount=?, display_currency=?, status=?,
               version=version+1, updated_at=datetime('now')
           WHERE id=?`,
        ).run(paid_amount, display_currency, status, id);

        if (status === "paid") {
          db.prepare(
            `UPDATE dues SET paid=1, paid_at=datetime('now'), version=version+1, updated_at=datetime('now')
             WHERE order_id=? AND paid=0`,
          ).run(id);
          const updatedDues = db
            .prepare(`SELECT * FROM dues WHERE order_id=? AND paid=1`)
            .all(id);
          for (const due of updatedDues)
            enqueue("dues", "update", due.id, strip(due, DUE_JOIN), [
              "paid",
              "paid_at",
            ]);
        }

        const freshOrder = freshRow("orders", id);
        enqueue("orders", "update", id, strip(freshOrder, ORDER_JOIN), [
          "paid_amount",
          "display_currency",
          "status",
        ]);
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
          if (item.product_id) {
            db.prepare(
              `UPDATE products SET stock=stock+?, version=version+1, updated_at=datetime('now') WHERE id=?`,
            ).run(item.quantity, item.product_id);
            const prod = freshRow("products", item.product_id);
            if (prod)
              enqueue(
                "products",
                "update",
                prod.id,
                strip(prod, PRODUCT_JOIN),
                ["stock"],
              );
          }
          db.prepare(
            `UPDATE order_items SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
          ).run(item.id);
          enqueue("order_items", "delete", item.id, null, null);
        }
        db.prepare(
          `UPDATE orders SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
        ).run(id);
        enqueue("orders", "delete", id, null, null);
      });
      restoreStock();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── DUES ──────────────────────────────────────────────────────────────────
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
            `SELECT d.*, c.name as customer_name, c.phone as customer_phone
             FROM dues d
             LEFT JOIN customers c ON d.customer_id=c.id
             WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(...params, limit, offset);
        const total = db
          .prepare(`SELECT COUNT(*) as n FROM dues d WHERE ${where}`)
          .get(...params).n;
        const totalUnpaidSp = db
          .prepare(
            `SELECT COALESCE(SUM(amount_sp),0) as n FROM dues d
             WHERE d._deleted=0 AND d.paid=0${customerId ? " AND d.customer_id=?" : ""}`,
          )
          .get(...(customerId ? [customerId] : [])).n;
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
        const before = freshRow("dues", due.id);
        db.prepare(
          `UPDATE dues
           SET customer_id=@customer_id, order_id=@order_id, amount=@amount,
               currency=@currency, amount_sp=@amount_sp, description=@description,
               due_date=@due_date, version=version+1, updated_at=datetime('now')
           WHERE id=@id`,
        ).run({ ...cleanDue, amount_sp: amountSp });
        const fresh = freshRow("dues", due.id);
        const changedFields = diffFields("dues", before, fresh);
        enqueue(
          "dues",
          "update",
          due.id,
          strip(fresh, DUE_JOIN),
          changedFields,
        );
        return { ok: true, id: due.id };
      } else {
        const id = uuid();
        db.prepare(
          `INSERT INTO dues
             (id, customer_id, order_id, amount, currency, amount_sp, description, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          cleanDue.customer_id,
          cleanDue.order_id,
          cleanDue.amount,
          cleanDue.currency,
          amountSp,
          cleanDue.description,
          cleanDue.due_date,
        );
        const fresh = freshRow("dues", id);
        enqueue("dues", "insert", id, strip(fresh, DUE_JOIN), null);
        return { ok: true, id };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:markDuePaid", (_, id) => {
    try {
      db.prepare(
        `UPDATE dues SET paid=1, paid_at=datetime('now'), version=version+1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      const fresh = freshRow("dues", id);
      // Only paid + paid_at changed — be precise
      enqueue("dues", "update", id, strip(fresh, DUE_JOIN), [
        "paid",
        "paid_at",
      ]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:deleteDue", (_, id) => {
    try {
      db.prepare(
        `UPDATE dues SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("dues", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── STAFF ─────────────────────────────────────────────────────────────────
  ipcMain.handle("store:getStaff", (_, { search = "" } = {}) => {
    try {
      const like = `%${search}%`;
      const data = db
        .prepare(
          `SELECT id, full_name, username, role, phone, email, is_active, created_at
           FROM staff
           WHERE _deleted=0 AND (full_name LIKE ? OR username LIKE ?)
           ORDER BY full_name`,
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
        const before = freshRow("staff", s.id);
        if (s.password) {
          db.prepare(
            `UPDATE staff
             SET full_name=@full_name, username=@username, password=@password,
                 role=@role, phone=@phone, email=@email, is_active=@is_active,
                 version=version+1, updated_at=datetime('now')
             WHERE id=@id`,
          ).run(s);
        } else {
          db.prepare(
            `UPDATE staff
             SET full_name=@full_name, username=@username, role=@role,
                 phone=@phone, email=@email, is_active=@is_active,
                 version=version+1, updated_at=datetime('now')
             WHERE id=@id`,
          ).run(s);
        }
        const fresh = freshRow("staff", s.id);
        // Never sync the password field — strip it from changed list too
        const changedFields = diffFields("staff", before, fresh).filter(
          (f) => f !== "password",
        );
        enqueue(
          "staff",
          "update",
          s.id,
          fresh ? { ...fresh, password: undefined } : { id: s.id },
          changedFields,
        );
        return { ok: true, id: s.id };
      } else {
        const id = uuid();
        db.prepare(
          `INSERT INTO staff
             (id, full_name, username, password, role, phone, email, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          s.full_name,
          s.username,
          s.password,
          s.role,
          s.phone,
          s.email,
          s.is_active,
        );
        const fresh = freshRow("staff", id);
        enqueue(
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
  });

  ipcMain.handle("store:deleteStaff", (_, id) => {
    try {
      db.prepare(
        `UPDATE staff SET _deleted=1, version=version+1, updated_at=datetime('now') WHERE id=?`,
      ).run(id);
      enqueue("staff", "delete", id, null, null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── REPORTS ───────────────────────────────────────────────────────────────
  ipcMain.handle("store:getRevenueReport", (_, { dateFrom, dateTo } = {}) => {
    try {
      const f = dateFrom || "2000-01-01";
      const t = dateTo || "2099-12-31";
      const rate = getDollarRate();
      const reportCurrency =
        db
          .prepare(`SELECT value FROM settings WHERE key='report_currency'`)
          .get()?.value ?? "SP";
      const divisor = reportCurrency === "USD" ? rate : 1;

      const daily = db
        .prepare(
          `SELECT date(order_date) as day,
                  SUM(total_sp) as total_sp,
                  COUNT(*) as orders,
                  SUM(CASE WHEN status='paid'  THEN total_sp ELSE 0 END) as paid_sp,
                  SUM(CASE WHEN status!='paid' THEN total_sp ELSE 0 END) as unpaid_sp
           FROM orders
           WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ?
           GROUP BY day ORDER BY day`,
        )
        .all(f, t)
        .map((row) => ({
          ...row,
          total: row.total_sp / divisor,
          paid: row.paid_sp / divisor,
          unpaid: row.unpaid_sp / divisor,
        }));

      const byStatus = db
        .prepare(
          `SELECT status, COUNT(*) as count, SUM(total_sp) as total_sp
           FROM orders
           WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ?
           GROUP BY status`,
        )
        .all(f, t);

      const topProducts = db
        .prepare(
          `SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.line_total_sp) as total_sp
           FROM order_items oi
           JOIN orders o ON oi.order_id=o.id
           WHERE oi._deleted=0 AND o._deleted=0 AND date(o.order_date) BETWEEN ? AND ?
           GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10`,
        )
        .all(f, t)
        .map((row) => ({ ...row, total: row.total_sp / divisor }));

      const totals = db
        .prepare(
          `SELECT COALESCE(SUM(total_sp),0) as revenue_sp,
                  COUNT(*) as orders,
                  COALESCE(SUM(CASE WHEN status='paid'  THEN total_sp ELSE 0 END),0) as paid_sp,
                  COALESCE(SUM(CASE WHEN status!='paid' THEN total_sp ELSE 0 END),0) as unpaid_sp
           FROM orders
           WHERE _deleted=0 AND date(order_date) BETWEEN ? AND ?`,
        )
        .get(f, t);

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
          `SELECT COUNT(*) as total_dues,
                  COALESCE(SUM(CASE WHEN paid=0 THEN amount_sp ELSE 0 END),0) as unpaid_sp,
                  COALESCE(SUM(CASE WHEN paid=1 THEN amount_sp ELSE 0 END),0) as paid_sp,
                  COUNT(CASE WHEN paid=0 THEN 1 END) as unpaid_count,
                  COUNT(CASE WHEN paid=1 THEN 1 END) as paid_count
           FROM dues
           WHERE _deleted=0 AND date(created_at) BETWEEN ? AND ?`,
        )
        .get(f, t);

      const topDebtors = db
        .prepare(
          `SELECT c.name, c.phone, COALESCE(SUM(d.amount_sp),0) as total_sp
           FROM dues d
           JOIN customers c ON d.customer_id=c.id
           WHERE d._deleted=0 AND d.paid=0
           GROUP BY d.customer_id ORDER BY total_sp DESC LIMIT 10`,
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

  // ── SETTINGS ──────────────────────────────────────────────────────────────
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
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
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

  // ── SYNC ──────────────────────────────────────────────────────────────────
  ipcMain.handle("store:getSyncQueue", () => {
    try {
      const data = db
        .prepare(
          `SELECT * FROM sync_queue
           WHERE synced_at IS NULL AND (retry_count IS NULL OR retry_count < 5)
           ORDER BY id ASC LIMIT 500`,
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
        `INSERT INTO sync_meta (key, value) VALUES ('last_synced_at', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).run(iso);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:getRawTable", (_, table) => {
    try {
      if (!ALLOWED_TABLES.has(table))
        return { ok: false, error: `Unknown table: ${table}` };
      const data = db.prepare(`SELECT * FROM "${table}"`).all();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:getAllOrderItems", () => {
    try {
      const data = db
        .prepare(`SELECT * FROM order_items WHERE _deleted=0`)
        .all();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── applyRemoteRow — field-level pull merge ───────────────────────────────
  // On pull, we receive the already-merged row from the server.
  // Locally we do a version-aware field-level update so any uncommitted
  // local edits to OTHER fields are preserved until the next push cycle.
  ipcMain.handle("store:applyRemoteRow", (_, { table, row }) => {
    try {
      if (!ALLOWED_TABLES.has(table))
        return { ok: false, error: `Unknown table: ${table}` };

      // Normalise booleans → integers for SQLite
      const normalized = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === "synced_at") continue;
        if (typeof v === "boolean") normalized[k] = v ? 1 : 0;
        else normalized[k] = v;
      }
      if (!("id" in normalized)) return { ok: false, error: "Missing row.id" };

      const existing = (() => {
        try {
          return db
            .prepare(`SELECT * FROM "${table}" WHERE id=?`)
            .get(normalized.id);
        } catch {
          return null;
        }
      })();

      if (!existing) {
        // Row is brand-new on this device — plain insert
        const cols = Object.keys(normalized);
        const colList = cols.map((c) => `"${c}"`).join(", ");
        const placeholders = cols.map(() => "?").join(", ");
        db.prepare("PRAGMA foreign_keys = OFF").run();
        try {
          db.prepare(
            `INSERT OR IGNORE INTO "${table}" (${colList}, synced_at) VALUES (${placeholders}, datetime('now'))`,
          ).run(...cols.map((c) => normalized[c]));
        } finally {
          db.prepare("PRAGMA foreign_keys = ON").run();
        }
        return { ok: true };
      }

      const remoteVersion = normalized.version ?? 0;
      const localVersion = existing.version ?? 0;

      if (remoteVersion < localVersion) {
        return { ok: true, skipped: true };
      }

      // When versions are equal, only apply if remote updated_at is newer
      if (remoteVersion === localVersion) {
        const remoteTs = normalized.updated_at ?? "";
        const localTs = existing.updated_at ?? "";
        if (remoteTs <= localTs) {
          const pending = db
            .prepare(
              `SELECT id FROM sync_queue WHERE row_id=? AND synced_at IS NULL LIMIT 1`,
            )
            .get(normalized.id);
          if (pending) return { ok: true, skipped: true };
        }
      }

      const skipCols = new Set(["id", "synced_at", "created_at"]);
      const updateCols = Object.keys(normalized).filter(
        (k) => !skipCols.has(k),
      );

      if (updateCols.length === 0) return { ok: true };

      const setClause = updateCols.map((c) => `"${c}" = ?`).join(", ");
      const vals = [...updateCols.map((c) => normalized[c]), normalized.id];

      db.prepare("PRAGMA foreign_keys = OFF").run();
      try {
        db.prepare(
          `UPDATE "${table}" SET ${setClause}, synced_at = datetime('now') WHERE id = ?`,
        ).run(...vals);
      } finally {
        db.prepare("PRAGMA foreign_keys = ON").run();
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Native fetch passthrough (used by renderer for external APIs) ─────────
  ipcMain.handle("native-fetch", async (_event, url) => {
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
