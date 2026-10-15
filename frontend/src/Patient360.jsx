
import { useState } from "react";
import {
  Search,
  UserRound,
  CalendarDays,
  ClipboardList,
  FlaskConical,
  BedDouble,
  Receipt,
  ShieldAlert,
  LoaderCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import "./Patient360.css";

const API_BASE = "http://127.0.0.1:8000";

const sections = [
  { id: "appointments", label: "Appointments", icon: CalendarDays },
  { id: "medical_records", label: "Medical history", icon: ClipboardList },
  { id: "labs", label: "Lab records", icon: FlaskConical },
  { id: "admissions", label: "Admissions", icon: BedDouble },
  { id: "billing", label: "Billing", icon: Receipt },
  { id: "care_gaps", label: "Care gaps", icon: ShieldAlert },
];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

function displayValue(value) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function Status({ value }) {
  const normalized = String(value || "Unknown")
    .toLowerCase()
    .replaceAll("_", " ");

  return <span className={`p360-status status-${normalized.replaceAll(" ", "-")}`}>
    {normalized}
  </span>;
}

function EmptyState({ message = "No records available." }) {
  return <div className="p360-empty">{message}</div>;
}

function RecordTable({ columns, rows, emptyMessage }) {
  if (!rows?.length) return <EmptyState message={emptyMessage} />;

  return (
    <div className="p360-table-wrap">
      <table className="p360-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.gap_id ?? index}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render
                    ? column.render(row[column.key], row)
                    : displayValue(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Patient360() {
  const [patientId, setPatientId] = useState("");
  const [patientData, setPatientData] = useState(null);
  const [activeSection, setActiveSection] = useState("appointments");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function searchPatient(event) {
    event.preventDefault();

    const id = patientId.trim();

    if (!id) {
      setError("Enter a patient ID to continue.");
      return;
    }

    setLoading(true);
    setError("");
    setPatientData(null);

    try {
      const response = await fetch(
        `${API_BASE}/api/patients/${encodeURIComponent(id)}`
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : `Unable to load patient (${response.status}).`
        );
      }

      setPatientData(result);
      setActiveSection("appointments");
    } catch (err) {
      setError(
        err.message ||
        "Could not connect to CareLens API. Check that the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }

  const patient = patientData?.patient;
  const counts = patientData?.record_counts || {};

  const name = patient
    ? [patient.first_name, patient.last_name].filter(Boolean).join(" ")
    : "";

  const fullName = name || `Patient ${patient?.id ?? ""}`;

  const labRows = (patientData?.lab_requests || []).map((request) => {
    const result = (patientData?.lab_results || []).find(
      (item) => String(item.request_id) === String(request.id)
    );

    return {
      ...request,
      result_details: result?.result_details ?? null,
      performed_date: result?.performed_date ?? null,
    };
  });

  function renderSection() {
    switch (activeSection) {
      case "appointments":
        return (
          <RecordTable
            emptyMessage="No appointments recorded for this patient."
            rows={patientData.appointments}
            columns={[
              { key: "appointment_date", label: "Date", render: formatDate },
              { key: "doctor_id", label: "Doctor ID" },
              {
                key: "status",
                label: "Status",
                render: (value) => <Status value={value} />,
              },
              { key: "notes", label: "Notes" },
            ]}
          />
        );

      case "medical_records":
        return (
          <RecordTable
            emptyMessage="No medical records found."
            rows={patientData.medical_records}
            columns={[
              { key: "created_at", label: "Date", render: formatDate },
              { key: "diagnosis", label: "Diagnosis" },
              { key: "treatment_plan", label: "Treatment plan" },
              { key: "doctor_id", label: "Doctor ID" },
            ]}
          />
        );

      case "labs":
        return (
          <RecordTable
            emptyMessage="No lab requests found."
            rows={labRows}
            columns={[
              { key: "request_date", label: "Requested", render: formatDate },
              { key: "test_id", label: "Test ID" },
              {
                key: "status",
                label: "Request status",
                render: (value) => <Status value={value} />,
              },
              { key: "performed_date", label: "Performed", render: formatDate },
              { key: "result_details", label: "Result" },
            ]}
          />
        );

      case "admissions":
        return (
          <RecordTable
            emptyMessage="No admissions recorded."
            rows={patientData.admissions}
            columns={[
              { key: "admission_date", label: "Admitted", render: formatDate },
              { key: "discharge_date", label: "Discharged", render: formatDate },
              { key: "primary_diagnosis", label: "Primary diagnosis" },
              { key: "bed_id", label: "Bed ID" },
            ]}
          />
        );

      case "billing":
        return (
          <RecordTable
            emptyMessage="No billing records found."
            rows={patientData.billing}
            columns={[
              { key: "billing_date", label: "Billing date", render: formatDate },
              {
                key: "total_amount",
                label: "Total",
                render: (value) =>
                  value == null ? "—" : Number(value).toLocaleString("en-IN", {
                    style: "currency",
                    currency: "INR",
                  }),
              },
              {
                key: "paid_amount",
                label: "Paid",
                render: (value) =>
                  value == null ? "—" : Number(value).toLocaleString("en-IN", {
                    style: "currency",
                    currency: "INR",
                  }),
              },
              { key: "status", label: "Billing status", render: (value) => <Status value={value} /> },
            ]}
          />
        );

      case "care_gaps":
        return (
          <>
            <p className="p360-note">
              These are rule-based candidates that require human review. They
              are not confirmed clinical failures.
            </p>
            <RecordTable
              emptyMessage="No care-gap candidates were flagged for this patient."
              rows={patientData.care_gap_candidates}
              columns={[
                { key: "gap_type", label: "Candidate" },
                { key: "event_date", label: "Event date", render: formatDate },
                { key: "evidence", label: "Evidence" },
                {
                  key: "priority",
                  label: "Priority",
                  render: (value) => <Status value={value} />,
                },
                {
                  key: "status",
                  label: "Review status",
                  render: (value) => <Status value={value || "Pending Review"} />,
                },
                { key: "assigned_to", label: "Assigned to" },
              ]}
            />
          </>
        );

      default:
        return null;
    }
  }

  return (
    <main className="p360-page">
      <header className="p360-header">
        <div>
          <div className="p360-eyebrow">CARELENS / PATIENT WORKSPACE</div>
          <h1>Patient 360</h1>
          <p>Explore patient records, care activity, and review candidates.</p>
        </div>
      </header>

      <form className="p360-search" onSubmit={searchPatient}>
        <label htmlFor="patient-id">Patient ID</label>
        <div className="p360-search-row">
          <input
            id="patient-id"
            type="text"
            inputMode="numeric"
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
            placeholder="Enter patient ID, e.g. 16"
            aria-describedby="patient-search-help"
          />
          <button type="submit" disabled={loading}>
            {loading ? (
              <LoaderCircle className="p360-spin" size={18} />
            ) : (
              <Search size={18} />
            )}
            {loading ? "Loading..." : "Find patient"}
          </button>
        </div>
        <small id="patient-search-help">
          Search uses the patient ID from your hospital dataset.
        </small>
      </form>

      {error && (
        <div className="p360-error" role="alert">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button type="button" onClick={searchPatient} disabled={loading}>
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      )}

      {!patientData && !loading && !error && (
        <div className="p360-welcome">
          <div className="p360-welcome-icon"><UserRound size={32} /></div>
          <h2>Find a patient to get started</h2>
          <p>Enter a patient ID above to view their linked healthcare records.</p>
        </div>
      )}

      {loading && (
        <div className="p360-loading">
          <LoaderCircle className="p360-spin" size={24} />
          <span>Loading patient records...</span>
        </div>
      )}

      {patientData && patient && (
        <>
          <section className="p360-profile">
            <div className="p360-avatar"><UserRound size={30} /></div>
            <div className="p360-profile-info">
              <span className="p360-eyebrow">PATIENT ID: {patient.id}</span>
              <h2>{fullName}</h2>
              <p>
                {displayValue(patient.gender)}{" "}
                <span>·</span> Born {displayValue(patient.date_of_birth)}
              </p>
            </div>
            <button
              className="p360-secondary-button"
              type="button"
              onClick={() => {
                setPatientData(null);
                setPatientId("");
                setError("");
              }}
            >
              New search
            </button>
          </section>

          <section className="p360-demographics">
            {[
              ["Email", patient.email],
              ["Phone", patient.phone],
              ["Emergency contact", patient.emergency_contact],
              ["Address", patient.address],
            ].map(([label, value]) => (
              <div className="p360-detail" key={label}>
                <span>{label}</span>
                <strong>{displayValue(value)}</strong>
              </div>
            ))}
          </section>

          <section className="p360-counts">
            {[
              ["Appointments", counts.appointments, CalendarDays],
              ["Medical records", counts.medical_records, ClipboardList],
              ["Lab requests", counts.lab_requests, FlaskConical],
              ["Admissions", counts.admissions, BedDouble],
              ["Billing records", counts.billing, Receipt],
              ["Care-gap candidates", counts.care_gap_candidates, ShieldAlert],
            ].map(([label, count, Icon]) => (
              <div className="p360-count-card" key={label}>
                <span className="p360-count-icon"><Icon size={18} /></span>
                <strong>{count ?? 0}</strong>
                <span>{label}</span>
              </div>
            ))}
          </section>

          <section className="p360-records">
            <div className="p360-section-heading">
              <div>
                <h2>Patient records</h2>
                <p>Choose a category to inspect its linked records.</p>
              </div>
            </div>

            <nav className="p360-tabs" aria-label="Patient record categories">
              {sections.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  className={activeSection === id ? "active" : ""}
                  onClick={() => setActiveSection(id)}
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </nav>

            <div className="p360-record-panel">
              {renderSection()}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
