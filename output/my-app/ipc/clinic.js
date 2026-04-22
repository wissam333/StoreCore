// my-app/ipc/clinic.js
// Register all clinic IPC handlers.
// Call registerClinicHandlers(db, ipcMain) from main.js after DB is ready.

export function registerClinicHandlers(db, ipcMain) {
  // ── helper: enqueue a sync item ──────────────────────────────────────────
  const enqueue = (table, operation, rowId, payload = null) => {
    db.prepare(`
      INSERT INTO sync_queue (table_name, operation, row_id, payload)
      VALUES (?, ?, ?, ?)
    `).run(table, operation, rowId, payload ? JSON.stringify(payload) : null);
  };

  // ── STATS ─────────────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getStats", () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const firstOfMonth = today.slice(0, 7) + "-01";
      return {
        ok: true,
        data: {
          totalPatients: db.prepare("SELECT COUNT(*) as n FROM patients WHERE _deleted=0").get().n,
          todayVisits:   db.prepare("SELECT COUNT(*) as n FROM visits WHERE date(visit_date)=? AND _deleted=0").get(today).n,
          pendingAppts:  db.prepare("SELECT COUNT(*) as n FROM appointments WHERE status='scheduled' AND _deleted=0").get().n,
          monthRevenue:  db.prepare("SELECT COALESCE(SUM(fee),0) as n FROM visits WHERE visit_date>=? AND paid=1 AND _deleted=0").get(firstOfMonth).n,
        },
      };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── PATIENTS ──────────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getPatients", (_, { search = "", limit = 50, offset = 0 } = {}) => {
    try {
      const like = `%${search}%`;
      const data = db.prepare(`
        SELECT *, (SELECT COUNT(*) FROM visits WHERE patient_id=patients.id AND _deleted=0) as visit_count,
               (SELECT MAX(visit_date) FROM visits WHERE patient_id=patients.id AND _deleted=0) as last_visit
        FROM patients
        WHERE _deleted=0 AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)
        ORDER BY full_name ASC LIMIT ? OFFSET ?
      `).all(like, like, like, limit, offset);
      const total = db.prepare("SELECT COUNT(*) as n FROM patients WHERE _deleted=0 AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)").get(like, like, like).n;
      return { ok: true, data, total };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:getPatientById", (_, id) => {
    try {
      const p = db.prepare("SELECT * FROM patients WHERE id=? AND _deleted=0").get(id);
      if (!p) return { ok: false, error: "Not found" };
      const visits = db.prepare("SELECT v.*, s.full_name as doctor_name FROM visits v LEFT JOIN staff s ON v.doctor_id=s.id WHERE v.patient_id=? AND v._deleted=0 ORDER BY v.visit_date DESC").all(id);
      const prescriptions = db.prepare("SELECT * FROM prescriptions WHERE patient_id=? AND _deleted=0 ORDER BY created_at DESC").all(id);
      const investigations = db.prepare("SELECT * FROM investigations WHERE patient_id=? AND _deleted=0 ORDER BY ordered_at DESC").all(id);
      const appointments = db.prepare("SELECT a.*, s.full_name as doctor_name FROM appointments a LEFT JOIN staff s ON a.doctor_id=s.id WHERE a.patient_id=? AND a._deleted=0 ORDER BY a.appt_date DESC").all(id);
      return { ok: true, data: { ...p, visits, prescriptions, investigations, appointments } };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:savePatient", (_, p) => {
    try {
      if (p.id) {
        db.prepare(`
          UPDATE patients SET full_name=@full_name, gender=@gender, dob=@dob, phone=@phone, email=@email,
          address=@address, blood_type=@blood_type, allergies=@allergies, notes=@notes, updated_at=datetime('now')
          WHERE id=@id
        `).run(p);
        enqueue("patients", "update", p.id, p);
        return { ok: true, id: p.id };
      } else {
        const r = db.prepare(`
          INSERT INTO patients (full_name, gender, dob, phone, email, address, blood_type, allergies, notes)
          VALUES (@full_name, @gender, @dob, @phone, @email, @address, @blood_type, @allergies, @notes)
        `).run(p);
        enqueue("patients", "insert", r.lastInsertRowid, { ...p, id: r.lastInsertRowid });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:deletePatient", (_, id) => {
    try {
      db.prepare("UPDATE patients SET _deleted=1, updated_at=datetime('now') WHERE id=?").run(id);
      enqueue("patients", "delete", id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── VISITS ────────────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getVisits", (_, { search = "", dateFrom, dateTo, doctorId, status, patientId, limit = 50, offset = 0 } = {}) => {
    try {
      let where = "v._deleted=0";
      const params = [];
      if (search) { where += " AND (p.full_name LIKE ? OR v.chief_complaint LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
      if (dateFrom) { where += " AND date(v.visit_date)>=?"; params.push(dateFrom); }
      if (dateTo) { where += " AND date(v.visit_date)<=?"; params.push(dateTo); }
      if (doctorId) { where += " AND v.doctor_id=?"; params.push(doctorId); }
      if (status) { where += " AND v.status=?"; params.push(status); }
      if (patientId) { where += " AND v.patient_id=?"; params.push(patientId); }

      const data = db.prepare(`
        SELECT v.*, p.full_name as patient_name, p.phone as patient_phone,
               s.full_name as doctor_name
        FROM visits v
        LEFT JOIN patients p ON v.patient_id=p.id
        LEFT JOIN staff    s ON v.doctor_id=s.id
        WHERE ${where}
        ORDER BY v.visit_date DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      const total = db.prepare(`
        SELECT COUNT(*) as n FROM visits v
        LEFT JOIN patients p ON v.patient_id=p.id
        WHERE ${where}
      `).get(...params).n;

      return { ok: true, data, total };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:getVisitById", (_, id) => {
    try {
      const visit = db.prepare(`
        SELECT v.*, p.full_name as patient_name, s.full_name as doctor_name
        FROM visits v
        LEFT JOIN patients p ON v.patient_id=p.id
        LEFT JOIN staff    s ON v.doctor_id=s.id
        WHERE v.id=? AND v._deleted=0
      `).get(id);
      if (!visit) return { ok: false, error: "Not found" };
      visit.prescriptions = db.prepare("SELECT * FROM prescriptions WHERE visit_id=? AND _deleted=0").all(id);
      visit.investigations = db.prepare("SELECT * FROM investigations WHERE visit_id=? AND _deleted=0").all(id);
      return { ok: true, data: visit };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:saveVisit", (_, v) => {
    try {
      if (v.id) {
        db.prepare(`
          UPDATE visits SET patient_id=@patient_id, doctor_id=@doctor_id, visit_date=@visit_date,
          chief_complaint=@chief_complaint, diagnosis=@diagnosis, treatment=@treatment,
          notes=@notes, status=@status, fee=@fee, paid=@paid, updated_at=datetime('now')
          WHERE id=@id
        `).run(v);
        // Update patient visit metadata
        db.prepare("UPDATE patients SET last_visit=@visit_date WHERE id=@patient_id").run(v);
        enqueue("visits", "update", v.id, v);
        return { ok: true, id: v.id };
      } else {
        const r = db.prepare(`
          INSERT INTO visits (patient_id, doctor_id, visit_date, chief_complaint, diagnosis, treatment, notes, status, fee, paid)
          VALUES (@patient_id, @doctor_id, @visit_date, @chief_complaint, @diagnosis, @treatment, @notes, @status, @fee, @paid)
        `).run(v);
        db.prepare("UPDATE patients SET visit_count=visit_count+1, last_visit=@visit_date WHERE id=@patient_id").run(v);
        enqueue("visits", "insert", r.lastInsertRowid, { ...v, id: r.lastInsertRowid });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:deleteVisit", (_, id) => {
    try {
      db.prepare("UPDATE visits SET _deleted=1, updated_at=datetime('now') WHERE id=?").run(id);
      enqueue("visits", "delete", id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── PRESCRIPTIONS ─────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getPrescriptions", (_, { visitId, patientId, search = "", limit = 50, offset = 0 } = {}) => {
    try {
      let where = "rx._deleted=0";
      const params = [];
      if (visitId) { where += " AND rx.visit_id=?"; params.push(visitId); }
      if (patientId) { where += " AND rx.patient_id=?"; params.push(patientId); }
      if (search) { where += " AND rx.drug_name LIKE ?"; params.push(`%${search}%`); }

      const data = db.prepare(`
        SELECT rx.*, p.full_name as patient_name FROM prescriptions rx
        LEFT JOIN patients p ON rx.patient_id=p.id
        WHERE ${where} ORDER BY rx.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);
      const total = db.prepare(`SELECT COUNT(*) as n FROM prescriptions rx WHERE ${where}`).get(...params).n;
      return { ok: true, data, total };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:savePrescription", (_, rx) => {
    try {
      if (rx.id) {
        db.prepare(`
          UPDATE prescriptions SET drug_name=@drug_name, dose=@dose, route=@route,
          frequency=@frequency, duration=@duration, instructions=@instructions, updated_at=datetime('now')
          WHERE id=@id
        `).run(rx);
        enqueue("prescriptions", "update", rx.id, rx);
        return { ok: true, id: rx.id };
      } else {
        const r = db.prepare(`
          INSERT INTO prescriptions (visit_id, patient_id, drug_name, dose, route, frequency, duration, instructions)
          VALUES (@visit_id, @patient_id, @drug_name, @dose, @route, @frequency, @duration, @instructions)
        `).run(rx);
        enqueue("prescriptions", "insert", r.lastInsertRowid, { ...rx, id: r.lastInsertRowid });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:deletePrescription", (_, id) => {
    try {
      db.prepare("UPDATE prescriptions SET _deleted=1 WHERE id=?").run(id);
      enqueue("prescriptions", "delete", id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── INVESTIGATIONS ────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getInvestigations", (_, { visitId, patientId, status, search = "", limit = 50, offset = 0 } = {}) => {
    try {
      let where = "inv._deleted=0";
      const params = [];
      if (visitId) { where += " AND inv.visit_id=?"; params.push(visitId); }
      if (patientId) { where += " AND inv.patient_id=?"; params.push(patientId); }
      if (status) { where += " AND inv.status=?"; params.push(status); }
      if (search) { where += " AND inv.test_name LIKE ?"; params.push(`%${search}%`); }

      const data = db.prepare(`
        SELECT inv.*, p.full_name as patient_name FROM investigations inv
        LEFT JOIN patients p ON inv.patient_id=p.id
        WHERE ${where} ORDER BY inv.ordered_at DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);
      const total = db.prepare(`SELECT COUNT(*) as n FROM investigations inv WHERE ${where}`).get(...params).n;
      return { ok: true, data, total };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:saveInvestigation", (_, inv) => {
    try {
      if (inv.id) {
        db.prepare(`
          UPDATE investigations SET test_name=@test_name, test_type=@test_type,
          result=@result, result_at=@result_at, status=@status, notes=@notes, updated_at=datetime('now')
          WHERE id=@id
        `).run(inv);
        enqueue("investigations", "update", inv.id, inv);
        return { ok: true, id: inv.id };
      } else {
        const r = db.prepare(`
          INSERT INTO investigations (visit_id, patient_id, test_name, test_type, ordered_at, status, notes)
          VALUES (@visit_id, @patient_id, @test_name, @test_type, @ordered_at, @status, @notes)
        `).run(inv);
        enqueue("investigations", "insert", r.lastInsertRowid, { ...inv, id: r.lastInsertRowid });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:deleteInvestigation", (_, id) => {
    try {
      db.prepare("UPDATE investigations SET _deleted=1 WHERE id=?").run(id);
      enqueue("investigations", "delete", id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── APPOINTMENTS ──────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getAppointments", (_, { dateFrom, dateTo, doctorId, status, patientId, limit = 50, offset = 0 } = {}) => {
    try {
      let where = "a._deleted=0";
      const params = [];
      if (dateFrom) { where += " AND date(a.appt_date)>=?"; params.push(dateFrom); }
      if (dateTo) { where += " AND date(a.appt_date)<=?"; params.push(dateTo); }
      if (doctorId) { where += " AND a.doctor_id=?"; params.push(doctorId); }
      if (status) { where += " AND a.status=?"; params.push(status); }
      if (patientId) { where += " AND a.patient_id=?"; params.push(patientId); }

      const data = db.prepare(`
        SELECT a.*, p.full_name as patient_name, p.phone as patient_phone, s.full_name as doctor_name
        FROM appointments a
        LEFT JOIN patients p ON a.patient_id=p.id
        LEFT JOIN staff    s ON a.doctor_id=s.id
        WHERE ${where} ORDER BY a.appt_date ASC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);
      const total = db.prepare(`SELECT COUNT(*) as n FROM appointments a WHERE ${where}`).get(...params).n;
      return { ok: true, data, total };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:saveAppointment", (_, a) => {
    try {
      if (a.id) {
        db.prepare(`
          UPDATE appointments SET patient_id=@patient_id, doctor_id=@doctor_id, appt_date=@appt_date,
          duration_min=@duration_min, reason=@reason, status=@status, notes=@notes, updated_at=datetime('now')
          WHERE id=@id
        `).run(a);
        enqueue("appointments", "update", a.id, a);
        return { ok: true, id: a.id };
      } else {
        const r = db.prepare(`
          INSERT INTO appointments (patient_id, doctor_id, appt_date, duration_min, reason, status, notes)
          VALUES (@patient_id, @doctor_id, @appt_date, @duration_min, @reason, @status, @notes)
        `).run(a);
        enqueue("appointments", "insert", r.lastInsertRowid, { ...a, id: r.lastInsertRowid });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:deleteAppointment", (_, id) => {
    try {
      db.prepare("UPDATE appointments SET _deleted=1 WHERE id=?").run(id);
      enqueue("appointments", "delete", id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── STAFF ─────────────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getStaff", (_, { search = "" } = {}) => {
    try {
      const like = `%${search}%`;
      const data = db.prepare(`
        SELECT id, full_name, username, role, specialty, phone, email, is_active, created_at
        FROM staff WHERE _deleted=0 AND (full_name LIKE ? OR username LIKE ? OR role LIKE ?)
        ORDER BY full_name
      `).all(like, like, like);
      return { ok: true, data };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:saveStaff", (_, s) => {
    try {
      if (s.id) {
        db.prepare(`
          UPDATE staff SET full_name=@full_name, role=@role, specialty=@specialty,
          phone=@phone, email=@email, is_active=@is_active, updated_at=datetime('now')
          WHERE id=@id
        `).run(s);
        enqueue("staff", "update", s.id, { ...s, password: undefined });
        return { ok: true, id: s.id };
      } else {
        const r = db.prepare(`
          INSERT INTO staff (full_name, username, password, role, specialty, phone, email, is_active)
          VALUES (@full_name, @username, @password, @role, @specialty, @phone, @email, @is_active)
        `).run(s);
        enqueue("staff", "insert", r.lastInsertRowid, { ...s, id: r.lastInsertRowid, password: undefined });
        return { ok: true, id: r.lastInsertRowid };
      }
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:deleteStaff", (_, id) => {
    try {
      db.prepare("UPDATE staff SET _deleted=1 WHERE id=?").run(id);
      enqueue("staff", "delete", id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── REPORTS ───────────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getRevenueReport", (_, { dateFrom, dateTo } = {}) => {
    try {
      const f = dateFrom || "2000-01-01";
      const t = dateTo || "2099-12-31";
      const daily = db.prepare(`
        SELECT date(visit_date) as day, SUM(fee) as total, COUNT(*) as visits
        FROM visits WHERE _deleted=0 AND paid=1 AND date(visit_date) BETWEEN ? AND ?
        GROUP BY day ORDER BY day
      `).all(f, t);
      const byDoctor = db.prepare(`
        SELECT s.full_name as doctor, SUM(v.fee) as total, COUNT(*) as visits
        FROM visits v LEFT JOIN staff s ON v.doctor_id=s.id
        WHERE v._deleted=0 AND v.paid=1 AND date(v.visit_date) BETWEEN ? AND ?
        GROUP BY v.doctor_id ORDER BY total DESC
      `).all(f, t);
      const totals = db.prepare(`
        SELECT SUM(fee) as revenue, COUNT(*) as visits,
               SUM(CASE WHEN paid=1 THEN fee ELSE 0 END) as paid,
               SUM(CASE WHEN paid=0 THEN fee ELSE 0 END) as unpaid
        FROM visits WHERE _deleted=0 AND date(visit_date) BETWEEN ? AND ?
      `).get(f, t);
      return { ok: true, data: { daily, byDoctor, totals } };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:getVisitsReport", (_, { dateFrom, dateTo } = {}) => {
    try {
      const f = dateFrom || "2000-01-01";
      const t = dateTo || "2099-12-31";
      const daily = db.prepare(`
        SELECT date(visit_date) as day, COUNT(*) as total,
               SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) as closed,
               SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open
        FROM visits WHERE _deleted=0 AND date(visit_date) BETWEEN ? AND ?
        GROUP BY day ORDER BY day
      `).all(f, t);
      const byStatus = db.prepare(`
        SELECT status, COUNT(*) as total FROM visits
        WHERE _deleted=0 AND date(visit_date) BETWEEN ? AND ?
        GROUP BY status
      `).all(f, t);
      const topDiagnoses = db.prepare(`
        SELECT diagnosis, COUNT(*) as total FROM visits
        WHERE _deleted=0 AND diagnosis IS NOT NULL AND diagnosis != '' AND date(visit_date) BETWEEN ? AND ?
        GROUP BY diagnosis ORDER BY total DESC LIMIT 10
      `).all(f, t);
      return { ok: true, data: { daily, byStatus, topDiagnoses } };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── SETTINGS ──────────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getSettings", () => {
    try {
      const rows = db.prepare("SELECT key, value FROM settings").all();
      return { ok: true, data: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:setSetting", (_, { key, value }) => {
    try {
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
      `).run(key, value);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── SYNC ──────────────────────────────────────────────────────────────────
  ipcMain.handle("clinic:getSyncQueue", () => {
    try {
      const data = db.prepare("SELECT * FROM sync_queue WHERE synced_at IS NULL ORDER BY id ASC LIMIT 200").all();
      return { ok: true, data };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:markSynced", (_, ids) => {
    try {
      if (!ids?.length) return { ok: true };
      const placeholders = ids.map(() => "?").join(",");
      db.prepare(`UPDATE sync_queue SET synced_at=datetime('now') WHERE id IN (${placeholders})`).run(...ids);
      db.prepare("UPDATE sync_meta SET value=datetime('now') WHERE key='last_synced_at'").run();
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle("clinic:getLastSyncedAt", () => {
    try {
      const r = db.prepare("SELECT value FROM sync_meta WHERE key='last_synced_at'").get();
      return { ok: true, data: r?.value ?? null };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}
