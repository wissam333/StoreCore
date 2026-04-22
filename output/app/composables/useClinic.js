// composables/useClinic.js
// All IPC calls go through window.clinic (exposed by preload.mjs)

const c = () => {
  if (import.meta.client && window.clinic) return window.clinic;
  // Dev-mode fallback: return no-op so pages don't crash in browser
  const noop = async () => ({ ok: false, data: [], error: "Not in Electron" });
  return new Proxy({}, { get: () => noop });
};

export const useClinic = () => {
  // ── STATS ────────────────────────────────────────────────────────────────
  const stats = () => c().getStats();

  // ── PATIENTS ─────────────────────────────────────────────────────────────
  const getPatients = (opts) => c().getPatients(opts);
  const getPatientById = (id) => c().getPatientById(id);
  const savePatient = (p) => c().savePatient(p);
  const deletePatient = (id) => c().deletePatient(id);

  // ── VISITS ───────────────────────────────────────────────────────────────
  const getVisits = (opts) => c().getVisits(opts);
  const getVisitById = (id) => c().getVisitById(id);
  const saveVisit = (v) => c().saveVisit(v);
  const deleteVisit = (id) => c().deleteVisit(id);

  // ── PRESCRIPTIONS ─────────────────────────────────────────────────────────
  const getPrescriptions = (opts) => c().getPrescriptions(opts);
  const savePrescription = (rx) => c().savePrescription(rx);
  const deletePrescription = (id) => c().deletePrescription(id);

  // ── INVESTIGATIONS ────────────────────────────────────────────────────────
  const getInvestigations = (opts) => c().getInvestigations(opts);
  const saveInvestigation = (inv) => c().saveInvestigation(inv);
  const deleteInvestigation = (id) => c().deleteInvestigation(id);

  // ── APPOINTMENTS ──────────────────────────────────────────────────────────
  const getAppointments = (opts) => c().getAppointments(opts);
  const saveAppointment = (a) => c().saveAppointment(a);
  const deleteAppointment = (id) => c().deleteAppointment(id);

  // ── STAFF ─────────────────────────────────────────────────────────────────
  const getStaff = () => c().getStaff();
  const saveStaff = (s) => c().saveStaff(s);
  const deleteStaff = (id) => c().deleteStaff(id);

  // ── REPORTS ───────────────────────────────────────────────────────────────
  const getRevenueReport = (opts) => c().getRevenueReport(opts);
  const getVisitsReport = (opts) => c().getVisitsReport(opts);

  // ── SETTINGS ──────────────────────────────────────────────────────────────
  const getSettings = () => c().getSettings();
  const setSetting = (kv) => c().setSetting(kv);

  // ── SYNC ──────────────────────────────────────────────────────────────────
  const getSyncQueue = () => c().getSyncQueue();
  const markSynced = (ids) => c().markSynced(ids);
  const getLastSyncedAt = () => c().getLastSyncedAt();

  return {
    stats,
    getPatients, getPatientById, savePatient, deletePatient,
    getVisits, getVisitById, saveVisit, deleteVisit,
    getPrescriptions, savePrescription, deletePrescription,
    getInvestigations, saveInvestigation, deleteInvestigation,
    getAppointments, saveAppointment, deleteAppointment,
    getStaff, saveStaff, deleteStaff,
    getRevenueReport, getVisitsReport,
    getSettings, setSetting,
    getSyncQueue, markSynced, getLastSyncedAt,
  };
};
