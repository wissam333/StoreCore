// store-app/composables/useStore.js
import { useMobileStore } from "./useMobileStore";

export const useStore = () => {
  // Decide path at call time — called at top of <script setup>, so timing is safe
  if (import.meta.client && !window.store) {
    return useMobileStore();
  }

  const s = () => {
    if (import.meta.client && window.store) return window.store;
    const noop = async () => ({
      ok: false,
      data: [],
      error: "Not in Electron",
    });
    return new Proxy({}, { get: () => noop });
  };

  return {
    getStats: () => s().getStats(),
    getCategories: () => s().getCategories(),
    saveCategory: (cat) => s().saveCategory(cat),
    deleteCategory: (id) => s().deleteCategory(id),
    getProducts: (opts) => s().getProducts(opts),
    getProductById: (id) => s().getProductById(id),
    saveProduct: (p) => s().saveProduct(p),
    deleteProduct: (id) => s().deleteProduct(id),
    adjustStock: (opts) => s().adjustStock(opts),
    getCustomers: (opts) => s().getCustomers(opts),
    getCustomerById: (id) => s().getCustomerById(id),
    saveCustomer: (c) => s().saveCustomer(c),
    deleteCustomer: (id) => s().deleteCustomer(id),
    findOrCreateCustomer: (name) => s().findOrCreateCustomer(name),
    getOrders: (opts) => s().getOrders(opts),
    getOrderById: (id) => s().getOrderById(id),
    saveOrder: (p) => s().saveOrder(p),
    updateOrderPayment: (opts) => s().updateOrderPayment(opts),
    deleteOrder: (id) => s().deleteOrder(id),
    // ── Payment methods ───────────────────────────────────────────────────
    getOrderPayments: (orderId) => s().getOrderPayments(orderId),
    addOrderPayment: (opts) => s().addOrderPayment(opts),
    deleteOrderPayment: (paymentId) => s().deleteOrderPayment(paymentId),
    markOrderFullyPaid: (opts) => s().markOrderFullyPaid(opts),
    // ── Dues ──────────────────────────────────────────────────────────────
    getDues: (opts) => s().getDues(opts),
    saveDue: (due) => s().saveDue(due),
    markDuePaid: (id) => s().markDuePaid(id),
    deleteDue: (id) => s().deleteDue(id),
    getStaff: (opts) => s().getStaff(opts),
    saveStaff: (staff) => s().saveStaff(staff),
    deleteStaff: (id) => s().deleteStaff(id),
    getRevenueReport: (opts) => s().getRevenueReport(opts),
    getDuesReport: (opts) => s().getDuesReport(opts),
    getSettings: () => s().getSettings(),
    setSetting: (kv) => s().setSetting(kv),
    fetchDollarRate: () => s().fetchDollarRate(),
    getSyncQueue: () => s().getSyncQueue(),
    markSynced: (ids) => s().markSynced(ids),
    getLastSyncedAt: () => s().getLastSyncedAt(),
    setLastSyncedAt: (iso) => s().setLastSyncedAt(iso),
    applyRemoteRow: (p) => s().applyRemoteRow(p),
    getAllOrderItems: () => s().getAllOrderItems(),
    getRawTable: (table) => s().getRawTable(table),
    getRoles: () => s().getRoles(),
    saveRole: (role) => s().saveRole(role),
    deleteRole: (id) => s().deleteRole(id),
  };
};
