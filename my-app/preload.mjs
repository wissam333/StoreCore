// store-app/electron/preload.js
import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("store", {
  // Stats
  getStats: () => invoke("store:getStats"),

  // Categories
  getCategories: () => invoke("store:getCategories"),
  saveCategory: (cat) => invoke("store:saveCategory", cat),
  deleteCategory: (id) => invoke("store:deleteCategory", id),

  // Products
  getProducts: (opts) => invoke("store:getProducts", opts),
  getProductById: (id) => invoke("store:getProductById", id),
  saveProduct: (p) => invoke("store:saveProduct", p),
  deleteProduct: (id) => invoke("store:deleteProduct", id),
  adjustStock: (opts) => invoke("store:adjustStock", opts),

  // Customers
  getCustomers: (opts) => invoke("store:getCustomers", opts),
  getCustomerById: (id) => invoke("store:getCustomerById", id),
  saveCustomer: (c) => invoke("store:saveCustomer", c),
  deleteCustomer: (id) => invoke("store:deleteCustomer", id),
  findOrCreateCustomer: (name) => invoke("store:findOrCreateCustomer", name),

  // Orders
  getOrders: (opts) => invoke("store:getOrders", opts),
  getOrderById: (id) => invoke("store:getOrderById", id),
  saveOrder: (payload) => invoke("store:saveOrder", payload),
  updateOrderPayment: (opts) => invoke("store:updateOrderPayment", opts),
  deleteOrder: (id) => invoke("store:deleteOrder", id),

  // Order Payments
  getOrderPayments: (orderId) => invoke("store:getOrderPayments", orderId),
  addOrderPayment: (opts) => invoke("store:addOrderPayment", opts),
  deleteOrderPayment: (paymentId) =>
    invoke("store:deleteOrderPayment", paymentId),
  markOrderFullyPaid: (opts) => invoke("store:markOrderFullyPaid", opts),

  // Dues
  getDues: (opts) => invoke("store:getDues", opts),
  saveDue: (due) => invoke("store:saveDue", due),
  markDuePaid: (id) => invoke("store:markDuePaid", id),
  deleteDue: (id) => invoke("store:deleteDue", id),

  // Staff (legacy generic CRUD — kept for backwards compat)
  getStaff: (opts) => invoke("store:getStaff", opts),
  saveStaff: (s) => invoke("store:saveStaff", s),
  deleteStaff: (id) => invoke("store:deleteStaff", id),

  // Reports
  getRevenueReport: (opts) => invoke("store:getRevenueReport", opts),
  getDuesReport: (opts) => invoke("store:getDuesReport", opts),

  // Settings
  getSettings: () => invoke("store:getSettings"),
  setSetting: (kv) => invoke("store:setSetting", kv),
  fetchDollarRate: () => invoke("store:fetchDollarRate"),

  // Sync
  getSyncQueue: () => invoke("store:getSyncQueue"),
  markSynced: (ids) => invoke("store:markSynced", ids),
  getLastSyncedAt: () => invoke("store:getLastSyncedAt"),
  setLastSyncedAt: (iso) => invoke("store:setLastSyncedAt", iso),
  applyRemoteRow: (payload) => invoke("store:applyRemoteRow", payload),

  // P2P sync
  getRawTable: (table) => invoke("store:getRawTable", table),
  getAllOrderItems: () => invoke("store:getAllOrderItems"),
});

// ── Auth bridge ──────────────────────────────────────────────────────────────
// The renderer never touches the session token directly — it only passes it
// back to these calls. The token is held in a Pinia store (memory only).
contextBridge.exposeInMainWorld("auth", {
  // Login / logout
  login: (credentials) => invoke("auth:login", credentials),
  logout: (token) => invoke("auth:logout", { token }),
  getSession: (token) => invoke("auth:getSession", { token }),
  checkPermission: (token, permission) =>
    invoke("auth:checkPermission", { token, permission }),

  // Password management
  changePassword: (token, currentPassword, newPassword) =>
    invoke("auth:changePassword", { token, currentPassword, newPassword }),
  resetPassword: (token, staffId, newPassword) =>
    invoke("auth:resetPassword", { token, staffId, newPassword }),

  // Roles (admin only)
  getRoles: (token) => invoke("auth:getRoles", { token }),
  saveRole: (token, role) => invoke("auth:saveRole", { token, role }),
  deleteRole: (token, roleId) => invoke("auth:deleteRole", { token, roleId }),

  // Staff management (admin only — uses auth layer, not raw store:saveStaff)
  getStaffWithRoles: (token, search) =>
    invoke("auth:getStaffWithRoles", { token, search }),
  saveStaff: (token, staff) => invoke("auth:saveStaff", { token, staff }),
  deleteStaff: (token, staffId) =>
    invoke("auth:deleteStaff", { token, staffId }),
});

contextBridge.exposeInMainWorld("license", {
  activate: (key) => ipcRenderer.invoke("license:activate", key),
  deactivate: () => ipcRenderer.invoke("license:deactivate"),
  getKey: () => ipcRenderer.invoke("license:getKey"),
  getMachineId: () => ipcRenderer.invoke("license:getMachineId"),
  onActivated: () => ipcRenderer.send("license:activated"),
});

contextBridge.exposeInMainWorld("electronAPI", {
  nativeFetch: (url) => ipcRenderer.invoke("native-fetch", url),
  p2pStartServer: () => ipcRenderer.invoke("p2p:start-server"),
  p2pStopServer: () => ipcRenderer.invoke("p2p:stop-server"),
});

contextBridge.exposeInMainWorld("__ELECTRON__", true);
