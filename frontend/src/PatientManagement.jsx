import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Users, UserRound, UserRoundPlus, RefreshCw, AlertCircle,
  CheckCircle2, CalendarDays, FileText, FlaskConical, Bed, Receipt,
  Activity, ChevronRight, X, Plus, Phone, Clock3, Pencil, Save, Mail,
  MapPin, HeartPulse, BellRing, CalendarClock, AlertTriangle,
} from "lucide-react";
import "./PatientManagement.css";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const RECORD_SECTIONS = [
  { key: "appointments", label: "Appointments", icon: CalendarDays },
  { key: "medical_records", label: "Medical records", icon: FileText },
  { key: "lab_requests", label: "Lab requests", icon: FlaskConical },
  { key: "lab_results", label: "Lab results", icon: Activity },
  { key: "admissions", label: "Admissions", icon: Bed },
  { key: "billing", label: "Billing", icon: Receipt },
  { key: "care_gap_candidates", label: "Care gaps", icon: AlertCircle },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const EMPTY_FORM = {
  first_name: "", last_name: "", date_of_birth: "", age: "", gender: "",
  email: "", phone: "", address: "", emergency_contact: "",
  disease: "", department: "", visit_date: today(), next_visit_date: "",
  visit_notes: "",
};

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function humanizeKey(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function getPatientName(patient) {
  if (!patient) return "Patient";
  const direct = patient.full_name || patient.patient_name || patient.name;
  if (direct) return String(direct);
  const combined = [patient.first_name, patient.middle_name, patient.last_name].filter(Boolean).join(" ");
  return combined || `Patient ${patient.id ?? ""}`.trim();
}
function getPatientSubtitle(patient) {
  return [patient?.gender || patient?.sex,
    patient?.age !== null && patient?.age !== undefined && patient.age !== "" ? `${patient.age} years` : null,
    patient?.phone || patient?.phone_number].filter(Boolean).join(" · ") || "Patient record";
}
function getInitials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "PT";
}
function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString();
}
function ageFromDob(dob) {
  if (!dob) return "";
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "";
  const now = new Date();
  return String(now.getFullYear() - birth.getFullYear() -
    ((now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) ? 1 : 0));
}
async function readApiError(response) {
  const body = await response.json().catch(() => ({}));
  if (typeof body.detail === "string") return body.detail;
  if (body.detail) return JSON.stringify(body.detail);
  return `Request failed (HTTP ${response.status}).`;
}
function DataTable({ rows, emptyMessage }) {
  const columns = useMemo(() => {
    const keys = new Set();
    rows.forEach((row) => row && typeof row === "object" && Object.keys(row).forEach((key) => keys.add(key)));
    return Array.from(keys).slice(0, 8);
  }, [rows]);
  if (!rows.length) return <div className="pm-empty-inline">{emptyMessage}</div>;
  return <div className="pm-table-wrap"><table className="pm-table">
    <thead><tr>{columns.map((column) => <th key={column}>{humanizeKey(column)}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.id ?? row.gap_id ?? row.request_id ?? index}>
      {columns.map((column) => <td key={column}><span className="pm-cell-value">{displayValue(row[column])}</span></td>)}
    </tr>)}</tbody>
  </table></div>;
}
function FormField({ label, required, children, className = "" }) {
  return <label className={`pm-form-field ${className}`}><span className="pm-field-label">{label}{required && <span className="pm-required"> *</span>}</span>{children}</label>;
}
function patientToForm(patient) {
  const fullName = String(patient?.name || patient?.full_name || "").trim().split(/\s+/);
  return {
    ...EMPTY_FORM,
    first_name: patient?.first_name || fullName[0] || "",
    last_name: patient?.last_name || fullName.slice(1).join(" "),
    date_of_birth: String(patient?.date_of_birth || "").slice(0, 10),
    age: patient?.age ?? "",
    gender: String(patient?.gender || patient?.sex || ""),
    email: patient?.email || "",
    phone: patient?.phone || patient?.phone_number || "",
    address: patient?.address || "",
    emergency_contact: patient?.emergency_contact || "",
    disease: patient?.disease || patient?.diagnosis || "",
    department: patient?.department || "",
    visit_date: String(patient?.visit_date || today()).slice(0, 10),
    next_visit_date: String(patient?.next_visit_date || "").slice(0, 10),
    visit_notes: patient?.visit_notes || "",
  };
}

export default function PatientManagement() {
  const [patients, setPatients] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [patientDetails, setPatientDetails] = useState(null);
  const [activeSection, setActiveSection] = useState("appointments");
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [followUps, setFollowUps] = useState([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [followUpError, setFollowUpError] = useState("");
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [savingDueDateId, setSavingDueDateId] = useState(null);
  const [dueDateDrafts, setDueDateDrafts] = useState({});
  const [followUpForm, setFollowUpForm] = useState({
    title: "", reason: "", due_date: today(), priority: "Medium", assigned_to: "",
  });

  const loadPatients = useCallback(async (query = "") => {
    setLoadingPatients(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "500" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`${API_BASE}/api/patients?${params}`);
      if (!response.ok) throw new Error(await readApiError(response));
      const body = await response.json();
      setPatients(Array.isArray(body) ? body : body.patients || body.items || body.results || []);
    } catch (err) {
      setError(err.message || "Could not connect to the CareLens API.");
    } finally { setLoadingPatients(false); }
  }, []);

  const loadPatientDetails = useCallback(async (patientId) => {
    if (patientId === null || patientId === undefined) return;
    setSelectedPatientId(patientId); setPatientDetails(null); setLoadingDetails(true); setDetailError("");
    try {
      const response = await fetch(`${API_BASE}/api/patients/${encodeURIComponent(patientId)}`);
      if (!response.ok) throw new Error(await readApiError(response));
      setPatientDetails(await response.json());
    } catch (err) {
      setDetailError(err.message || "Unable to load the selected patient's details.");
    } finally { setLoadingDetails(false); }
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);
  useEffect(() => {
    const timer = setTimeout(() => loadPatients(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, loadPatients]);

  const loadPatientFollowUps = useCallback(async (patientId) => {
    if (patientId === null || patientId === undefined) return;
    setLoadingFollowUps(true);
    setFollowUpError("");
    try {
      const response = await fetch(
        `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/follow-ups?include_closed=true`
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const body = await response.json();
      const items = Array.isArray(body) ? body : body.follow_ups || body.items || [];
      setFollowUps(items);
      setDueDateDrafts(Object.fromEntries(items.map((item) => [String(item.id), String(item.due_date || "").slice(0, 10)])));
    } catch (err) {
      setFollowUpError(err.message || "Could not load this patient's follow-ups.");
      setFollowUps([]);
    } finally {
      setLoadingFollowUps(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPatientId !== null && selectedPatientId !== undefined) {
      loadPatientFollowUps(selectedPatientId);
    } else {
      setFollowUps([]);
    }
  }, [selectedPatientId, loadPatientFollowUps]);

  async function handleAddFollowUp(event) {
    event.preventDefault();
    if (!selectedPatient) return;
    setFollowUpError("");
    setFollowUpMessage("");
    if (!followUpForm.title.trim() || !followUpForm.reason.trim() || !followUpForm.due_date) {
      setFollowUpError("Enter a title, reason, and due date.");
      return;
    }
    setSavingFollowUp(true);
    try {
      const response = await fetch(`${API_BASE}/api/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: String(selectedPatient.id),
          title: followUpForm.title.trim(),
          reason: followUpForm.reason.trim(),
          due_date: followUpForm.due_date,
          priority: followUpForm.priority,
          assigned_to: followUpForm.assigned_to.trim() || null,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setFollowUpForm({ title: "", reason: "", due_date: today(), priority: "Medium", assigned_to: "" });
      setFollowUpMessage("Follow-up added successfully.");
      await loadPatientFollowUps(selectedPatient.id);
      // The app-level notification monitor polls this same endpoint automatically.
    } catch (err) {
      setFollowUpError(err.message || "Could not add this follow-up.");
    } finally {
      setSavingFollowUp(false);
    }
  }

  async function saveFollowUpDueDate(item) {
    const id = String(item.id);
    const nextDate = String(dueDateDrafts[id] || "").slice(0, 10);
    if (!nextDate) {
      setFollowUpError("Choose a valid due date before saving.");
      return;
    }
    setFollowUpError("");
    setFollowUpMessage("");
    setSavingDueDateId(id);
    try {
      const response = await fetch(`${API_BASE}/api/follow-ups/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Send only the field being edited so other follow-up data is preserved.
        body: JSON.stringify({ due_date: nextDate }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const body = await response.json().catch(() => ({}));
      const savedFollowUp = body.follow_up || body;
      if (String(savedFollowUp.due_date || "").slice(0, 10) !== nextDate) {
        throw new Error("The backend did not save the new due date. Update FollowUpUpdate and update_followup in the backend to accept and persist due_date.");
      }
      setFollowUpMessage("Follow-up due date updated.");
      await loadPatientFollowUps(selectedPatientId);
    } catch (err) {
      setFollowUpError(err.message || "Could not update the due date.");
    } finally {
      setSavingDueDateId(null);
    }
  }

  const selectedPatient = patientDetails?.patient || patients.find((p) => String(p.id) === String(selectedPatientId));
  const recordCounts = patientDetails?.record_counts || {};
  const activeRecordSection = RECORD_SECTIONS.find((s) => s.key === activeSection);
  const activeRows = patientDetails?.[activeSection] || [];

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "date_of_birth" && value) next.age = ageFromDob(value);
      return next;
    });
    setFormError("");
  }
  function openAddModal() {
    setEditing(false); setForm({ ...EMPTY_FORM, visit_date: today() });
    setFormError(""); setSuccessMessage(""); setModalOpen(true);
  }
  function openEditModal() {
    if (!selectedPatient) return;
    setEditing(true); setForm(patientToForm(selectedPatient));
    setFormError(""); setSuccessMessage(""); setModalOpen(true);
  }
  function closeModal() {
    if (saving) return;
    setModalOpen(false); setFormError("");
  }

  async function handleSubmit(event) {
    event.preventDefault(); setFormError(""); setSuccessMessage("");
    const first = form.first_name.trim();
    const last = form.last_name.trim();
    const name = [first, last].filter(Boolean).join(" ");
    if (!first) return setFormError("Enter the patient's first name.");
    if (!last) return setFormError("Enter the patient's last name.");
    if (!form.gender) return setFormError("Select the patient's gender.");
    if (!form.date_of_birth && (form.age === "" || !Number.isInteger(Number(form.age)) || Number(form.age) < 0 || Number(form.age) > 120)) {
      return setFormError("Enter a valid date of birth or age between 0 and 120.");
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setFormError("Enter a valid email address.");
    if (!editing && (!form.disease.trim() || !form.department)) return setFormError("For a new patient, enter the diagnosis and select a department.");
    if (!editing && !form.visit_date) return setFormError("Select the visit date.");
    if (!editing && form.next_visit_date && form.next_visit_date < form.visit_date) return setFormError("The next visit cannot be earlier than the visit date.");

    setSaving(true);
    const profile = {
      first_name: first, last_name: last, name,
      date_of_birth: form.date_of_birth || null,
      age: form.date_of_birth ? Number(ageFromDob(form.date_of_birth)) : Number(form.age),
      gender: form.gender, email: form.email.trim(), phone: form.phone.trim(),
      address: form.address.trim(), emergency_contact: form.emergency_contact.trim(),
      next_visit_date: form.next_visit_date || null,
    };
    try {
      let response;
      if (editing) {
        response = await fetch(`${API_BASE}/api/patients/${encodeURIComponent(selectedPatientId)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
        });
      } else {
        response = await fetch(`${API_BASE}/api/patients`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...profile, disease: form.disease.trim(), department: form.department,
            visit_date: form.visit_date, next_visit_date: form.next_visit_date || null,
            visit_notes: form.visit_notes.trim(),
          }),
        });
      }
      if (!response.ok) throw new Error(await readApiError(response));
      const body = await response.json();
      const patient = body.patient || body;
      setModalOpen(false);
      setSuccessMessage(editing ? "Patient profile updated successfully." : "Patient added successfully.");
      await loadPatients(searchInput);
      const id = editing ? selectedPatientId : patient.id;
      if (id !== undefined && id !== null) await loadPatientDetails(id);
    } catch (err) {
      setFormError(err.message || "Could not save the patient. Check the API and try again.");
    } finally { setSaving(false); }
  }

  return <main className="pm-page">
    <header className="pm-page-header">
      <div><div className="pm-eyebrow"><Users size={15} /> CARE OPERATIONS</div>
        <h1>Patient Management</h1><p>Search patient records and review linked hospital activity in one workspace.</p></div>
      <div className="pm-header-actions">
        <button type="button" className="pm-button pm-button-primary" onClick={openAddModal}><Plus size={17} /> Add Patient</button>
        <button type="button" className="pm-button pm-button-secondary" onClick={() => { loadPatients(searchInput); if (selectedPatientId !== null) loadPatientDetails(selectedPatientId); }} disabled={loadingPatients || loadingDetails}><RefreshCw size={16} className={loadingPatients || loadingDetails ? "pm-spin" : ""} /> Refresh</button>
      </div>
    </header>

    {successMessage && <div className="pm-alert pm-alert-success" role="status"><CheckCircle2 size={19} /><span>{successMessage}</span><button type="button" className="pm-icon-button" onClick={() => setSuccessMessage("")} aria-label="Dismiss success message"><X size={17} /></button></div>}

    <div className="pm-summary-grid">
      <article className="pm-summary-card"><div className="pm-summary-icon pm-icon-blue"><Users size={20} /></div><div><span>Patients shown</span><strong>{loadingPatients ? "…" : patients.length}</strong><small>Based on the current search</small></div></article>
      <article className="pm-summary-card"><div className="pm-summary-icon pm-icon-green"><UserRound size={20} /></div><div><span>Selected patient</span><strong>{selectedPatient ? "1" : "0"}</strong><small>{selectedPatient ? `ID: ${selectedPatient.id}` : "Choose a patient to view records"}</small></div></article>
      <article className="pm-summary-card"><div className="pm-summary-icon pm-icon-purple"><FileText size={20} /></div><div><span>Linked records</span><strong>{patientDetails ? Object.values(recordCounts).reduce((sum, n) => sum + (typeof n === "number" ? n : 0), 0) : "—"}</strong><small>{patientDetails ? "Across returned record categories" : "Select a patient to calculate"}</small></div></article>
    </div>

    {error && <div className="pm-alert pm-alert-error"><AlertCircle size={19} /><div><strong>Patient list could not be loaded</strong><p>{error}</p><small>Check that FastAPI is running and GET /api/patients is available.</small></div><button type="button" className="pm-icon-button" onClick={() => setError("")} aria-label="Dismiss error"><X size={17} /></button></div>}

    <section className="pm-workspace">
      <aside className="pm-patient-panel">
        <div className="pm-panel-heading"><div><h2>Patient directory</h2><p>Find and select a patient</p></div><span className="pm-count-badge">{patients.length}</span></div>
        <label className="pm-search"><Search size={18} /><input type="search" placeholder="Search ID, name, phone…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label="Search patients" />{searchInput && <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search"><X size={15} /></button>}</label>
        <div className="pm-patient-list">
          {loadingPatients && patients.length === 0 ? <div className="pm-list-message"><RefreshCw size={20} className="pm-spin" /><span>Loading patients…</span></div> :
          patients.length === 0 ? <div className="pm-list-message"><Users size={24} /><strong>No patients found</strong><span>{searchInput ? "Try another search term." : "Add a patient to get started."}</span><button type="button" className="pm-button pm-button-primary" onClick={openAddModal}><Plus size={16} /> Add Patient</button></div> :
          patients.map((patient) => { const name = getPatientName(patient); const selected = String(patient.id) === String(selectedPatientId); return <button type="button" key={patient.id} className={`pm-patient-item ${selected ? "is-selected" : ""}`} onClick={() => loadPatientDetails(patient.id)}><span className="pm-avatar">{getInitials(name)}</span><span className="pm-patient-copy"><strong>{name}</strong><small>ID: {displayValue(patient.id)}</small><small>{getPatientSubtitle(patient)}</small></span><ChevronRight size={17} /></button>; })}
        </div>
        <div className="pm-panel-footer"><span className="pm-status-dot" /> Connected to CareLens API</div>
      </aside>

      <section className="pm-details-panel">
        {!selectedPatientId ? <div className="pm-detail-placeholder"><div className="pm-placeholder-icon"><UserRound size={32} /></div><h2>Select a patient</h2><p>Choose someone from the directory to view their profile and linked hospital activity.</p><button type="button" className="pm-button pm-button-primary" onClick={openAddModal}><UserRoundPlus size={17} /> Add a new patient</button></div> :
        loadingDetails ? <div className="pm-detail-placeholder"><RefreshCw size={28} className="pm-spin" /><h2>Loading patient record</h2><p>Retrieving linked information from CareLens.</p></div> :
        detailError ? <div className="pm-detail-placeholder"><div className="pm-placeholder-icon pm-placeholder-error"><AlertCircle size={30} /></div><h2>Unable to load patient details</h2><p>{detailError}</p><button type="button" className="pm-button pm-button-primary" onClick={() => loadPatientDetails(selectedPatientId)}>Try again</button></div> :
        patientDetails && selectedPatient ? <>
          <div className="pm-profile-header"><div className="pm-profile-main"><span className="pm-avatar pm-avatar-large">{getInitials(getPatientName(selectedPatient))}</span><div><div className="pm-eyebrow">PATIENT PROFILE</div><h2>{getPatientName(selectedPatient)}</h2><p>Patient ID: {selectedPatient.id}</p></div></div><div className="pm-header-actions"><button type="button" className="pm-button pm-button-primary" onClick={openEditModal}><Pencil size={16} /> Edit Profile</button><button type="button" className="pm-button pm-button-secondary" onClick={() => { setSelectedPatientId(null); setPatientDetails(null); setDetailError(""); }}><X size={15} /> Close profile</button></div></div>
          <div className="pm-profile-facts">
            {[["First name", selectedPatient.first_name], ["Last name", selectedPatient.last_name], ["Date of birth", formatDate(selectedPatient.date_of_birth)], ["Age", selectedPatient.age], ["Gender", selectedPatient.gender || selectedPatient.sex], ["Email", selectedPatient.email], ["Phone", selectedPatient.phone || selectedPatient.phone_number], ["Address", selectedPatient.address], ["Emergency contact", selectedPatient.emergency_contact], ["Diagnosis", selectedPatient.disease || selectedPatient.diagnosis], ["Department", selectedPatient.department]].map(([label, value]) => <div className="pm-fact" key={label}><span>{label}</span><strong>{displayValue(value)}</strong></div>)}
          </div>
          <div className="pm-record-heading"><div><h3>Linked hospital records</h3><p>Select a category to inspect the returned records.</p></div><span className="pm-loaded-indicator"><CheckCircle2 size={15} /> Loaded</span></div>
          <div className="pm-record-tabs">{RECORD_SECTIONS.map((section) => { const Icon = section.icon; const count = recordCounts[section.key] ?? 0; return <button type="button" key={section.key} className={`pm-record-tab ${activeSection === section.key ? "is-active" : ""}`} onClick={() => setActiveSection(section.key)}><Icon size={16} /><span>{section.label}</span><b>{count}</b></button>; })}</div>
          <div className="pm-record-content"><div className="pm-record-content-heading"><div><h3>{activeRecordSection?.label}</h3><p>{activeRows.length} record{activeRows.length === 1 ? "" : "s"}</p></div></div><DataTable rows={activeRows} emptyMessage={`No ${activeRecordSection?.label.toLowerCase()} were returned for this patient.`} /></div>
          {patientDetails.note && <div className="pm-note"><AlertCircle size={16} /><span>{patientDetails.note}</span></div>}

          <section className="pm-record-content" style={{ marginTop: 24 }}>
            <div className="pm-record-content-heading">
              <div><h3><BellRing size={17} style={{ verticalAlign: "-3px", marginRight: 8 }} />Patient follow-ups</h3><p>Add follow-ups and reschedule due dates from this patient profile.</p></div>
              <span className="pm-count-badge">{followUps.length}</span>
            </div>
            {followUpMessage && <div className="pm-alert pm-alert-success" role="status"><CheckCircle2 size={17} /><span>{followUpMessage}</span><button type="button" className="pm-icon-button" onClick={() => setFollowUpMessage("")} aria-label="Dismiss follow-up message"><X size={16} /></button></div>}
            {followUpError && <div className="pm-alert pm-alert-error" role="alert"><AlertCircle size={17} /><span>{followUpError}</span><button type="button" className="pm-icon-button" onClick={() => setFollowUpError("")} aria-label="Dismiss follow-up error"><X size={16} /></button></div>}

            <form onSubmit={handleAddFollowUp} className="pm-add-form" style={{ padding: 0, marginBottom: 20 }}>
              <div className="pm-form-grid">
                <FormField label="Follow-up title" required><input value={followUpForm.title} onChange={(e) => setFollowUpForm((f) => ({ ...f, title: e.target.value }))} maxLength={200} required placeholder="e.g. Blood pressure review" /></FormField>
                <FormField label="Due date" required><input type="date" value={followUpForm.due_date} onChange={(e) => setFollowUpForm((f) => ({ ...f, due_date: e.target.value }))} required /></FormField>
                <FormField label="Priority" required><select value={followUpForm.priority} onChange={(e) => setFollowUpForm((f) => ({ ...f, priority: e.target.value }))}><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></FormField>
                <FormField label="Assigned to"><input value={followUpForm.assigned_to} onChange={(e) => setFollowUpForm((f) => ({ ...f, assigned_to: e.target.value }))} maxLength={120} placeholder="Staff member (optional)" /></FormField>
                <FormField label="Reason / instructions" required className="pm-field-full"><textarea value={followUpForm.reason} onChange={(e) => setFollowUpForm((f) => ({ ...f, reason: e.target.value }))} maxLength={2000} rows={2} required placeholder="Why is this follow-up needed?" /></FormField>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button type="submit" className="pm-button pm-button-primary" disabled={savingFollowUp}>{savingFollowUp ? <><RefreshCw size={15} className="pm-spin" /> Saving…</> : <><Plus size={16} /> Add follow-up</>}</button></div>
            </form>

            {loadingFollowUps ? <div className="pm-empty-inline">Loading follow-ups…</div> : followUps.length === 0 ? <div className="pm-empty-inline">No follow-ups have been recorded for this patient yet.</div> :
              <div className="pm-table-wrap"><table className="pm-table"><thead><tr><th>Follow-up</th><th>Priority</th><th>Status</th><th>Due date</th><th>Timing</th><th>Action</th></tr></thead><tbody>
                {followUps.map((item) => {
                  const overdue = Number(item.days_overdue || 0) > 0 && !["completed", "complete", "closed", "cancelled", "canceled"].includes(String(item.status || "").toLowerCase());
                  return <tr key={item.id}>
                    <td><strong>{item.title || "Follow-up"}</strong><div style={{ color: "var(--text-muted, #64748b)", fontSize: 12, marginTop: 4 }}>{item.reason || "—"}</div>{item.assigned_to && <div style={{ fontSize: 12, marginTop: 4 }}>Assigned: {item.assigned_to}</div>}</td>
                    <td>{item.priority || item.alert_level || "Medium"}</td>
                    <td>{item.status || "Pending"}</td>
                    <td><input aria-label={`New due date for ${item.title || "follow-up"}`} type="date" value={dueDateDrafts[String(item.id)] || String(item.due_date || "").slice(0, 10)} onChange={(e) => setDueDateDrafts((drafts) => ({ ...drafts, [String(item.id)]: e.target.value }))} /></td>
                    <td>{overdue ? <span style={{ color: "#b42318", fontWeight: 700 }}><AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />{item.days_overdue} day(s) overdue</span> : <span>{item.timing_label || (item.due_date ? `Due ${formatDate(item.due_date)}` : "Date unavailable")}</span>}</td>
                    <td><button type="button" className="pm-button pm-button-secondary" onClick={() => saveFollowUpDueDate(item)} disabled={savingDueDateId === String(item.id) || (dueDateDrafts[String(item.id)] || "") === String(item.due_date || "").slice(0, 10)}>{savingDueDateId === String(item.id) ? <><RefreshCw size={14} className="pm-spin" /> Saving</> : <><Save size={14} /> Save date</>}</button></td>
                  </tr>;
                })}
              </tbody></table></div>
            }
          </section>
        </> : <div className="pm-detail-placeholder"><h2>Patient details unavailable</h2><p>The API response did not contain a patient profile.</p></div>}
      </section>
    </section>

    {modalOpen && <div className="pm-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <section className="pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-form-title">
        <header className="pm-modal-header"><div className="pm-modal-title-group"><div className="pm-modal-icon">{editing ? <Pencil size={23} /> : <UserRoundPlus size={23} />}</div><div><span className="pm-eyebrow">CARE OPERATIONS</span><h2 id="pm-form-title">{editing ? "Edit Patient Profile" : "Add Patient"}</h2><p>{editing ? "Update the patient's personal details." : "Create a patient profile and record their first visit."}</p></div></div><button type="button" className="pm-icon-button pm-modal-close" onClick={closeModal} disabled={saving} aria-label="Close patient form"><X size={20} /></button></header>
        <form className="pm-add-form" onSubmit={handleSubmit}>
          <div className="pm-form-section"><div className="pm-form-section-title"><UserRound size={17} /><h3>Personal information</h3></div><div className="pm-form-grid">
            <FormField label="First name" required><input name="first_name" value={form.first_name} onChange={updateForm} maxLength={100} required placeholder="First name" /></FormField>
            <FormField label="Last name" required><input name="last_name" value={form.last_name} onChange={updateForm} maxLength={100} required placeholder="Last name" /></FormField>
            <FormField label="Date of birth"><input name="date_of_birth" type="date" value={form.date_of_birth} max={today()} onChange={updateForm} /></FormField>
            <FormField label="Age (if DOB unavailable)"><input name="age" type="number" min="0" max="120" value={form.date_of_birth ? ageFromDob(form.date_of_birth) : form.age} onChange={updateForm} disabled={Boolean(form.date_of_birth)} placeholder="Age in years" /></FormField>
            <FormField label="Gender" required><select name="gender" value={form.gender} onChange={updateForm} required><option value="">Select gender</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="unspecified">Prefer not to say</option></select></FormField>
            <FormField label="Email"><div className="pm-input-with-icon"><Mail size={16} /><input name="email" type="email" value={form.email} onChange={updateForm} maxLength={254} placeholder="name@example.com" /></div></FormField>
            <FormField label="Phone number"><div className="pm-input-with-icon"><Phone size={16} /><input name="phone" type="tel" value={form.phone} onChange={updateForm} maxLength={30} placeholder="Contact number" /></div></FormField>
            <FormField label="Emergency contact"><input name="emergency_contact" value={form.emergency_contact} onChange={updateForm} maxLength={150} placeholder="Contact name / phone" /></FormField>
            <FormField label="Address" className="pm-field-full"><div className="pm-input-with-icon"><MapPin size={16} /><input name="address" value={form.address} onChange={updateForm} maxLength={300} placeholder="Street address" /></div></FormField>
          </div></div>

          {!editing && <div className="pm-form-section"><div className="pm-form-section-title"><HeartPulse size={17} /><h3>Initial visit details</h3></div><div className="pm-form-grid">
            <FormField label="Disease / diagnosis" required><input name="disease" value={form.disease} onChange={updateForm} maxLength={250} required placeholder="Enter diagnosis" /></FormField>
            <FormField label="Department" required><select name="department" value={form.department} onChange={updateForm} required><option value="">Select department</option>{["General Medicine","Cardiology","Neurology","Orthopedics","Pediatrics","Gynecology","Dermatology","Oncology","Pulmonology","Endocrinology","Emergency","Other"].map((d) => <option key={d} value={d}>{d}</option>)}</select></FormField>
            <FormField label="Date visited" required><div className="pm-input-with-icon"><CalendarDays size={16} /><input name="visit_date" type="date" value={form.visit_date} onChange={updateForm} required /></div></FormField>
            <FormField label="Next follow-up date"><div className="pm-input-with-icon"><Clock3 size={16} /><input name="next_visit_date" type="date" value={form.next_visit_date} min={form.visit_date || undefined} onChange={updateForm} /></div></FormField>
            <FormField label="Visit notes" className="pm-field-full"><textarea name="visit_notes" value={form.visit_notes} onChange={updateForm} maxLength={2000} rows={3} placeholder="Optional notes about this visit" /></FormField>
          </div></div>}
          {editing && <div className="pm-form-section"><div className="pm-form-section-title"><CalendarClock size={17} /><h3>Follow-up scheduling</h3></div><div className="pm-form-grid">
            <FormField label="Next visit / follow-up date"><div className="pm-input-with-icon"><Clock3 size={16} /><input name="next_visit_date" type="date" value={form.next_visit_date} onChange={updateForm} /></div></FormField>
            <p className="pm-field-help pm-field-full">Changing this date creates or reschedules the automatically managed “Next visit follow-up”. Manually created follow-ups are not changed.</p>
          </div></div>}

          {formError && <div className="pm-alert pm-alert-error pm-form-error"><AlertCircle size={18} /><span>{formError}</span></div>}
          <footer className="pm-modal-footer"><span className="pm-form-required-note">* Required fields</span><div><button type="button" className="pm-button pm-button-secondary" onClick={closeModal} disabled={saving}>Cancel</button><button type="submit" className="pm-button pm-button-primary" disabled={saving}>{saving ? <><RefreshCw size={16} className="pm-spin" /> Saving…</> : <><Save size={17} /> {editing ? "Save Changes" : "Save Patient"}</>}</button></div></footer>
        </form>
      </section>
    </div>}
  </main>;
}
