
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Users,
  UserRound,
  UserRoundPlus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  CalendarDays,
  FileText,
  FlaskConical,
  Bed,
  Receipt,
  Activity,
  ChevronRight,
  X,
  Plus,
  Stethoscope,
  Phone,
  Clock3,
} from "lucide-react";
import "./PatientManagement.css";

const API_BASE = "http://127.0.0.1:8000";

const RECORD_SECTIONS = [
  { key: "appointments", label: "Appointments", icon: CalendarDays },
  { key: "medical_records", label: "Medical records", icon: FileText },
  { key: "lab_requests", label: "Lab requests", icon: FlaskConical },
  { key: "lab_results", label: "Lab results", icon: Activity },
  { key: "admissions", label: "Admissions", icon: Bed },
  { key: "billing", label: "Billing", icon: Receipt },
  { key: "care_gap_candidates", label: "Care gaps", icon: AlertCircle },
];

const EMPTY_FORM = {
  name: "",
  age: "",
  gender: "",
  phone: "",
  disease: "",
  department: "",
  visit_date: new Date().toLocaleDateString("en-CA"),
  next_visit_date: "",
  visit_notes: "",
};

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humanizeKey(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getPatientName(patient) {
  if (!patient) return "Patient";

  const directName =
    patient.full_name || patient.patient_name || patient.name;

  if (directName) return String(directName);

  const combined = [
    patient.first_name,
    patient.middle_name,
    patient.last_name,
  ]
    .filter(Boolean)
    .join(" ");

  return combined || `Patient ${patient.id ?? ""}`.trim();
}

function getPatientSubtitle(patient) {
  const details = [
    patient?.gender || patient?.sex,
    patient?.age !== null && patient?.age !== undefined && patient.age !== ""
      ? `${patient.age} years`
      : null,
    patient?.phone || patient?.phone_number,
  ].filter(Boolean);

  return details.join(" · ") || "Patient record";
}

function getInitials(name) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "PT"
  );
}

function formatDate(value) {
  if (!value) return "—";

  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function readApiError(response) {
  const body = await response.json().catch(() => ({}));
  const detail = body.detail;

  if (typeof detail === "string") return detail;
  if (detail) return JSON.stringify(detail);

  return `Request failed (HTTP ${response.status}).`;
}

function DataTable({ rows, emptyMessage }) {
  const columns = useMemo(() => {
    const keys = new Set();

    rows.forEach((row) => {
      if (row && typeof row === "object") {
        Object.keys(row).forEach((key) => keys.add(key));
      }
    });

    return Array.from(keys).slice(0, 8);
  }, [rows]);

  if (!rows.length) {
    return <div className="pm-empty-inline">{emptyMessage}</div>;
  }

  return (
    <div className="pm-table-wrap">
      <table className="pm-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{humanizeKey(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.gap_id ?? row.request_id ?? index}>
              {columns.map((column) => (
                <td key={column}>
                  <span className="pm-cell-value">
                    {displayValue(row[column])}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormField({ label, required, children, className = "" }) {
  return (
    <label className={`pm-form-field ${className}`}>
      <span className="pm-field-label">
        {label}
        {required && <span className="pm-required"> *</span>}
      </span>
      {children}
    </label>
  );
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

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [savingPatient, setSavingPatient] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadPatients = useCallback(async (query = "") => {
    setLoadingPatients(true);
    setError("");

    try {
      const params = new URLSearchParams({ limit: "500" });

      if (query.trim()) params.set("q", query.trim());

      const response = await fetch(
        `${API_BASE}/api/patients?${params.toString()}`
      );

      if (!response.ok) throw new Error(await readApiError(response));

      const body = await response.json();
      const list = Array.isArray(body)
        ? body
        : body.patients || body.items || body.results || [];

      setPatients(list);

      setSelectedPatientId((currentId) => {
        if (
          currentId !== null &&
          !list.some((patient) => String(patient.id) === String(currentId))
        ) {
          setPatientDetails(null);
          return null;
        }

        return currentId;
      });
    } catch (err) {
      setError(err.message || "Could not connect to the CareLens API.");
    } finally {
      setLoadingPatients(false);
    }
  }, []);

  const loadPatientDetails = useCallback(async (patientId) => {
    if (patientId === null || patientId === undefined) return;

    setSelectedPatientId(patientId);
    setPatientDetails(null);
    setLoadingDetails(true);
    setDetailError("");

    try {
      const response = await fetch(
        `${API_BASE}/api/patients/${encodeURIComponent(patientId)}`
      );

      if (!response.ok) throw new Error(await readApiError(response));

      setPatientDetails(await response.json());
    } catch (err) {
      setDetailError(
        err.message || "Unable to load the selected patient's details."
      );
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPatients(searchInput);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, loadPatients]);

  const selectedPatient =
    patientDetails?.patient ||
    patients.find(
      (patient) => String(patient.id) === String(selectedPatientId)
    );

  const recordCounts = patientDetails?.record_counts || {};
  const activeRecordSection = RECORD_SECTIONS.find(
    (section) => section.key === activeSection
  );
  const activeRows = patientDetails?.[activeSection] || [];

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({ ...current, [name]: value }));
    setFormError("");
  }

  function openAddModal() {
    setForm({
      ...EMPTY_FORM,
      visit_date: new Date().toLocaleDateString("en-CA"),
    });
    setFormError("");
    setSuccessMessage("");
    setAddModalOpen(true);
  }

  function closeAddModal() {
    if (savingPatient) return;
    setAddModalOpen(false);
    setFormError("");
  }

  async function handleAddPatient(event) {
    event.preventDefault();
    setFormError("");
    setSuccessMessage("");

    const age = Number(form.age);

    if (!form.name.trim()) {
      setFormError("Enter the patient's full name.");
      return;
    }

    if (form.age === "" || !Number.isInteger(age) || age < 0 || age > 120) {
      setFormError("Enter a valid age between 0 and 120.");
      return;
    }

    if (!form.gender) {
      setFormError("Select the patient's gender.");
      return;
    }

    if (!form.disease.trim() || !form.department) {
      setFormError("Enter the disease and select a department.");
      return;
    }

    if (!form.visit_date) {
      setFormError("Select the visit date.");
      return;
    }

    if (
      form.next_visit_date &&
      form.next_visit_date < form.visit_date
    ) {
      setFormError("The next visit cannot be earlier than the visit date.");
      return;
    }

    setSavingPatient(true);

    try {
      // Requires POST /api/patients in the FastAPI backend.
      const response = await fetch(`${API_BASE}/api/patients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          age,
          gender: form.gender,
          phone: form.phone.trim(),
          disease: form.disease.trim(),
          department: form.department,
          visit_date: form.visit_date,
          next_visit_date: form.next_visit_date || null,
          visit_notes: form.visit_notes.trim(),
        }),
      });

      if (!response.ok) throw new Error(await readApiError(response));

      const body = await response.json();
      const createdPatient = body.patient || body;

      setAddModalOpen(false);
      setForm(EMPTY_FORM);
      setSuccessMessage("Patient added successfully.");

      await loadPatients(searchInput);

      if (createdPatient.id !== undefined && createdPatient.id !== null) {
        await loadPatientDetails(createdPatient.id);
      }
    } catch (err) {
      setFormError(
        err.message ||
          "Could not save the patient. Check the API connection and try again."
      );
    } finally {
      setSavingPatient(false);
    }
  }

  return (
    <main className="pm-page">
      <header className="pm-page-header">
        <div>
          <div className="pm-eyebrow">
            <Users size={15} />
            CARE OPERATIONS
          </div>
          <h1>Patient Management</h1>
          <p>
            Search patient records and review linked hospital activity in one
            workspace.
          </p>
        </div>

        <div className="pm-header-actions">
          <button
            type="button"
            className="pm-button pm-button-primary"
            onClick={openAddModal}
          >
            <Plus size={17} />
            Add Patient
          </button>

          <button
            type="button"
            className="pm-button pm-button-secondary"
            onClick={() => {
              loadPatients(searchInput);
              if (selectedPatientId !== null) {
                loadPatientDetails(selectedPatientId);
              }
            }}
            disabled={loadingPatients || loadingDetails}
          >
            <RefreshCw
              size={16}
              className={
                loadingPatients || loadingDetails ? "pm-spin" : ""
              }
            />
            Refresh
          </button>
        </div>
      </header>

      {successMessage && (
        <div className="pm-alert pm-alert-success" role="status">
          <CheckCircle2 size={19} />
          <span>{successMessage}</span>
          <button
            type="button"
            className="pm-icon-button"
            onClick={() => setSuccessMessage("")}
            aria-label="Dismiss success message"
          >
            <X size={17} />
          </button>
        </div>
      )}

      <div className="pm-summary-grid">
        <article className="pm-summary-card">
          <div className="pm-summary-icon pm-icon-blue">
            <Users size={20} />
          </div>
          <div>
            <span>Patients shown</span>
            <strong>{loadingPatients ? "…" : patients.length}</strong>
            <small>Based on the current search</small>
          </div>
        </article>

        <article className="pm-summary-card">
          <div className="pm-summary-icon pm-icon-green">
            <UserRound size={20} />
          </div>
          <div>
            <span>Selected patient</span>
            <strong>{selectedPatient ? "1" : "0"}</strong>
            <small>
              {selectedPatient
                ? `ID: ${selectedPatient.id}`
                : "Choose a patient to view records"}
            </small>
          </div>
        </article>

        <article className="pm-summary-card">
          <div className="pm-summary-icon pm-icon-purple">
            <FileText size={20} />
          </div>
          <div>
            <span>Linked records</span>
            <strong>
              {patientDetails
                ? Object.values(recordCounts).reduce(
                    (sum, count) =>
                      sum + (typeof count === "number" ? count : 0),
                    0
                  )
                : "—"}
            </strong>
            <small>
              {patientDetails
                ? "Across returned record categories"
                : "Select a patient to calculate"}
            </small>
          </div>
        </article>
      </div>

      {error && (
        <div className="pm-alert pm-alert-error">
          <AlertCircle size={19} />
          <div>
            <strong>Patient list could not be loaded</strong>
            <p>{error}</p>
            <small>
              Check that FastAPI is running and GET /api/patients is available.
            </small>
          </div>
          <button
            type="button"
            className="pm-icon-button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={17} />
          </button>
        </div>
      )}

      <section className="pm-workspace">
        <aside className="pm-patient-panel">
          <div className="pm-panel-heading">
            <div>
              <h2>Patient directory</h2>
              <p>Find and select a patient</p>
            </div>
            <span className="pm-count-badge">{patients.length}</span>
          </div>

          <label className="pm-search">
            <Search size={18} />
            <input
              type="search"
              placeholder="Search ID, name, phone…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search patients"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </label>

          <div className="pm-patient-list">
            {loadingPatients && patients.length === 0 ? (
              <div className="pm-list-message">
                <RefreshCw size={20} className="pm-spin" />
                <span>Loading patients…</span>
              </div>
            ) : patients.length === 0 ? (
              <div className="pm-list-message">
                <Users size={24} />
                <strong>No patients found</strong>
                <span>
                  {searchInput
                    ? "Try another search term."
                    : "Add a patient to get started."}
                </span>
                <button
                  type="button"
                  className="pm-button pm-button-primary"
                  onClick={openAddModal}
                >
                  <Plus size={16} />
                  Add Patient
                </button>
              </div>
            ) : (
              patients.map((patient) => {
                const name = getPatientName(patient);
                const selected =
                  String(patient.id) === String(selectedPatientId);

                return (
                  <button
                    type="button"
                    key={patient.id}
                    className={`pm-patient-item ${
                      selected ? "is-selected" : ""
                    }`}
                    onClick={() => loadPatientDetails(patient.id)}
                  >
                    <span className="pm-avatar">{getInitials(name)}</span>
                    <span className="pm-patient-copy">
                      <strong>{name}</strong>
                      <small>ID: {displayValue(patient.id)}</small>
                      <small>{getPatientSubtitle(patient)}</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                );
              })
            )}
          </div>

          <div className="pm-panel-footer">
            <span className="pm-status-dot" />
            Connected to CareLens API
          </div>
        </aside>

        <section className="pm-details-panel">
          {!selectedPatientId ? (
            <div className="pm-detail-placeholder">
              <div className="pm-placeholder-icon">
                <UserRound size={32} />
              </div>
              <h2>Select a patient</h2>
              <p>
                Choose someone from the directory to view their profile,
                appointments, medical records, lab activity, admissions,
                billing, and care-gap flags.
              </p>
              <button
                type="button"
                className="pm-button pm-button-primary"
                onClick={openAddModal}
              >
                <UserRoundPlus size={17} />
                Add a new patient
              </button>
            </div>
          ) : loadingDetails ? (
            <div className="pm-detail-placeholder">
              <RefreshCw size={28} className="pm-spin" />
              <h2>Loading patient record</h2>
              <p>Retrieving linked information from CareLens.</p>
            </div>
          ) : detailError ? (
            <div className="pm-detail-placeholder">
              <div className="pm-placeholder-icon pm-placeholder-error">
                <AlertCircle size={30} />
              </div>
              <h2>Unable to load patient details</h2>
              <p>{detailError}</p>
              <button
                type="button"
                className="pm-button pm-button-primary"
                onClick={() => loadPatientDetails(selectedPatientId)}
              >
                Try again
              </button>
            </div>
          ) : patientDetails && selectedPatient ? (
            <>
              <div className="pm-profile-header">
                <div className="pm-profile-main">
                  <span className="pm-avatar pm-avatar-large">
                    {getInitials(getPatientName(selectedPatient))}
                  </span>
                  <div>
                    <div className="pm-eyebrow">PATIENT PROFILE</div>
                    <h2>{getPatientName(selectedPatient)}</h2>
                    <p>Patient ID: {selectedPatient.id}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="pm-button pm-button-secondary"
                  onClick={() => {
                    setSelectedPatientId(null);
                    setPatientDetails(null);
                    setDetailError("");
                  }}
                >
                  <X size={15} />
                  Close profile
                </button>
              </div>

              <div className="pm-profile-facts">
                {[
                  ["Gender", selectedPatient.gender || selectedPatient.sex],
                  ["Age", selectedPatient.age],
                  ["Phone", selectedPatient.phone || selectedPatient.phone_number],
                  ["Email", selectedPatient.email],
                  ["Disease", selectedPatient.disease || selectedPatient.diagnosis],
                  ["Department", selectedPatient.department],
                ].map(([label, value]) => (
                  <div className="pm-fact" key={label}>
                    <span>{label}</span>
                    <strong>{displayValue(value)}</strong>
                  </div>
                ))}
              </div>

              <div className="pm-record-heading">
                <div>
                  <h3>Linked hospital records</h3>
                  <p>Select a category to inspect the returned records.</p>
                </div>
                <span className="pm-loaded-indicator">
                  <CheckCircle2 size={15} />
                  Loaded
                </span>
              </div>

              <div className="pm-record-tabs">
                {RECORD_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  const count = recordCounts[section.key] ?? 0;

                  return (
                    <button
                      type="button"
                      key={section.key}
                      className={`pm-record-tab ${
                        activeSection === section.key ? "is-active" : ""
                      }`}
                      onClick={() => setActiveSection(section.key)}
                    >
                      <Icon size={16} />
                      <span>{section.label}</span>
                      <b>{count}</b>
                    </button>
                  );
                })}
              </div>

              <div className="pm-record-content">
                <div className="pm-record-content-heading">
                  <div>
                    <h3>{activeRecordSection?.label}</h3>
                    <p>
                      {activeRows.length} record
                      {activeRows.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <DataTable
                  rows={activeRows}
                  emptyMessage={`No ${activeRecordSection?.label.toLowerCase()} were returned for this patient.`}
                />
              </div>

              {patientDetails.note && (
                <div className="pm-note">
                  <AlertCircle size={16} />
                  <span>{patientDetails.note}</span>
                </div>
              )}
            </>
          ) : (
            <div className="pm-detail-placeholder">
              <h2>Patient details unavailable</h2>
              <p>The API response did not contain a patient profile.</p>
            </div>
          )}
        </section>
      </section>

      {addModalOpen && (
        <div
          className="pm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAddModal();
          }}
        >
          <section
            className="pm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pm-add-title"
          >
            <header className="pm-modal-header">
              <div className="pm-modal-title-group">
                <div className="pm-modal-icon">
                  <UserRoundPlus size={23} />
                </div>
                <div>
                  <span className="pm-eyebrow">CARE OPERATIONS</span>
                  <h2 id="pm-add-title">Add Patient</h2>
                  <p>Create a patient profile and record their visit.</p>
                </div>
              </div>
              <button
                type="button"
                className="pm-icon-button pm-modal-close"
                onClick={closeAddModal}
                disabled={savingPatient}
                aria-label="Close add patient form"
              >
                <X size={20} />
              </button>
            </header>

            <form className="pm-add-form" onSubmit={handleAddPatient}>
              <div className="pm-form-section">
                <div className="pm-form-section-title">
                  <UserRound size={17} />
                  <h3>Personal information</h3>
                </div>

                <div className="pm-form-grid">
                  <FormField label="Full name" required>
                    <input
                      name="name"
                      value={form.name}
                      onChange={updateForm}
                      placeholder="Enter patient's full name"
                      maxLength={150}
                      required
                    />
                  </FormField>

                  <FormField label="Age" required>
                    <input
                      name="age"
                      type="number"
                      min="0"
                      max="120"
                      step="1"
                      value={form.age}
                      onChange={updateForm}
                      placeholder="Age in years"
                      required
                    />
                  </FormField>

                  <FormField label="Gender" required>
                    <select
                      name="gender"
                      value={form.gender}
                      onChange={updateForm}
                      required
                    >
                      <option value="">Select gender</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="other">Other</option>
                      <option value="unspecified">Prefer not to say</option>
                    </select>
                  </FormField>

                  <FormField label="Phone number">
                    <div className="pm-input-with-icon">
                      <Phone size={16} />
                      <input
                        name="phone"
                        type="tel"
                        value={form.phone}
                        onChange={updateForm}
                        placeholder="Contact number"
                        maxLength={30}
                      />
                    </div>
                  </FormField>
                </div>
              </div>

              <div className="pm-form-section">
                <div className="pm-form-section-title">
                  <Stethoscope size={17} />
                  <h3>Medical and visit details</h3>
                </div>

                <div className="pm-form-grid">
                  <FormField label="Disease / diagnosis" required>
                    <input
                      name="disease"
                      value={form.disease}
                      onChange={updateForm}
                      placeholder="Enter diagnosis"
                      maxLength={250}
                      required
                    />
                  </FormField>

                  <FormField label="Department" required>
                    <select
                      name="department"
                      value={form.department}
                      onChange={updateForm}
                      required
                    >
                      <option value="">Select department</option>
                      <option value="General Medicine">General Medicine</option>
                      <option value="Cardiology">Cardiology</option>
                      <option value="Neurology">Neurology</option>
                      <option value="Orthopedics">Orthopedics</option>
                      <option value="Pediatrics">Pediatrics</option>
                      <option value="Gynecology">Gynecology</option>
                      <option value="Dermatology">Dermatology</option>
                      <option value="Oncology">Oncology</option>
                      <option value="Pulmonology">Pulmonology</option>
                      <option value="Endocrinology">Endocrinology</option>
                      <option value="Emergency">Emergency</option>
                      <option value="Other">Other</option>
                    </select>
                  </FormField>

                  <FormField label="Date visited" required>
                    <div className="pm-input-with-icon">
                      <CalendarDays size={16} />
                      <input
                        name="visit_date"
                        type="date"
                        value={form.visit_date}
                        onChange={updateForm}
                        max="9999-12-31"
                        required
                      />
                    </div>
                  </FormField>

                  <FormField label="Next follow-up date">
                    <div className="pm-input-with-icon">
                      <Clock3 size={16} />
                      <input
                        name="next_visit_date"
                        type="date"
                        value={form.next_visit_date}
                        onChange={updateForm}
                        min={form.visit_date || undefined}
                      />
                    </div>
                  </FormField>

                  <FormField label="Visit notes" className="pm-field-full">
                    <textarea
                      name="visit_notes"
                      value={form.visit_notes}
                      onChange={updateForm}
                      placeholder="Optional notes about this visit"
                      maxLength={2000}
                      rows={3}
                    />
                  </FormField>
                </div>
              </div>

              {formError && (
                <div className="pm-alert pm-alert-error pm-form-error">
                  <AlertCircle size={18} />
                  <span>{formError}</span>
                </div>
              )}

              <footer className="pm-modal-footer">
                <span className="pm-form-required-note">
                  * Required fields
                </span>
                <div>
                  <button
                    type="button"
                    className="pm-button pm-button-secondary"
                    onClick={closeAddModal}
                    disabled={savingPatient}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="pm-button pm-button-primary"
                    disabled={savingPatient}
                  >
                    {savingPatient ? (
                      <>
                        <RefreshCw size={16} className="pm-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={17} />
                        Save Patient
                      </>
                    )}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
