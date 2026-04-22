// my-app/preload.mjs
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("clinic", {
  // Stats
  getStats: () => ipcRenderer.invoke("clinic:getStats"),

  // Patients
  getPatients:    (opts) => ipcRenderer.invoke("clinic:getPatients", opts),
  getPatientById: (id)   => ipcRenderer.invoke("clinic:getPatientById", id),
  savePatient:    (p)    => ipcRenderer.invoke("clinic:savePatient", p),
  deletePatient:  (id)   => ipcRenderer.invoke("clinic:deletePatient", id),

  // Visits
  getVisits:    (opts) => ipcRenderer.invoke("clinic:getVisits", opts),
  getVisitById: (id)   => ipcRenderer.invoke("clinic:getVisitById", id),
  saveVisit:    (v)    => ipcRenderer.invoke("clinic:saveVisit", v),
  deleteVisit:  (id)   => ipcRenderer.invoke("clinic:deleteVisit", id),

  // Prescriptions
  getPrescriptions:  (opts) => ipcRenderer.invoke("clinic:getPrescriptions", opts),
  savePrescription:  (rx)   => ipcRenderer.invoke("clinic:savePrescription", rx),
  deletePrescription:(id)   => ipcRenderer.invoke("clinic:deletePrescription", id),

  // Investigations
  getInvestigations:  (opts) => ipcRenderer.invoke("clinic:getInvestigations", opts),
  saveInvestigation:  (inv)  => ipcRenderer.invoke("clinic:saveInvestigation", inv),
  deleteInvestigation:(id)   => ipcRenderer.invoke("clinic:deleteInvestigation", id),

  // Appointments
  getAppointments:  (opts) => ipcRenderer.invoke("clinic:getAppointments", opts),
  saveAppointment:  (a)    => ipcRenderer.invoke("clinic:saveAppointment", a),
  deleteAppointment:(id)   => ipcRenderer.invoke("clinic:deleteAppointment", id),

  // Staff
  getStaff:    (opts) => ipcRenderer.invoke("clinic:getStaff", opts),
  saveStaff:   (s)    => ipcRenderer.invoke("clinic:saveStaff", s),
  deleteStaff: (id)   => ipcRenderer.invoke("clinic:deleteStaff", id),

  // Reports
  getRevenueReport: (opts) => ipcRenderer.invoke("clinic:getRevenueReport", opts),
  getVisitsReport:  (opts) => ipcRenderer.invoke("clinic:getVisitsReport", opts),

  // Settings
  getSettings: ()   => ipcRenderer.invoke("clinic:getSettings"),
  setSetting:  (kv) => ipcRenderer.invoke("clinic:setSetting", kv),

  // Sync
  getSyncQueue:    ()    => ipcRenderer.invoke("clinic:getSyncQueue"),
  markSynced:      (ids) => ipcRenderer.invoke("clinic:markSynced", ids),
  getLastSyncedAt: ()    => ipcRenderer.invoke("clinic:getLastSyncedAt"),
});
