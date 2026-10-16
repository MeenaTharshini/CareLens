import sqlite3
from pathlib import Path
from datetime import date

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from followup_store import STATUSES, list_followups, get_followup, create_followup, update_followup
from review_store import REVIEW_STATUSES, get_reviews, update_review, get_review_history
from engine import (
    load_data, validate_data, validate_relationships, calculate_metrics,
    build_care_gap_worklist, build_population_analytics, build_operational_trends,
    build_analytics_insights, build_attendance_breakdown, build_attendance_trends,
)

app = FastAPI(title="CareLens API", description="Healthcare Quality and Care Gap Analytics", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "https://care-lens-roan.vercel.app",
        "https://care-lens-spra-luqwy80ce-meena-tharshini-is-projects.vercel.app",
    ],
    allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
)

DB_PATH = Path(__file__).resolve().parent / "data" / "hospital.db"


def get_db_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_manual_patients_table():
    with get_db_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS manual_patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                phone TEXT DEFAULT '',
                disease TEXT NOT NULL,
                department TEXT NOT NULL,
                visit_date TEXT NOT NULL,
                next_visit_date TEXT,
                visit_notes TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        existing = {row["name"] for row in connection.execute("PRAGMA table_info(manual_patients)").fetchall()}
        columns = {
            "first_name": "TEXT DEFAULT ''", "last_name": "TEXT DEFAULT ''",
            "date_of_birth": "TEXT", "email": "TEXT DEFAULT ''",
            "address": "TEXT DEFAULT ''", "emergency_contact": "TEXT DEFAULT ''",
        }
        for column, definition in columns.items():
            if column not in existing:
                connection.execute(f"ALTER TABLE manual_patients ADD COLUMN {column} {definition}")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS patient_profile_overrides (
                patient_id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, name TEXT,
                date_of_birth TEXT, age INTEGER, gender TEXT, email TEXT, phone TEXT,
                address TEXT, emergency_contact TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


init_manual_patients_table()


class ManualPatientCreate(BaseModel):
    name: str = Field(default="", max_length=150)
    first_name: str = Field(default="", max_length=100)
    last_name: str = Field(default="", max_length=100)
    date_of_birth: date | None = None
    age: int = Field(ge=0, le=120)
    gender: str = Field(min_length=1, max_length=30)
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=30)
    address: str = Field(default="", max_length=500)
    emergency_contact: str = Field(default="", max_length=150)
    disease: str = Field(min_length=1, max_length=250)
    department: str = Field(min_length=1, max_length=100)
    visit_date: date
    next_visit_date: date | None = None
    visit_notes: str = Field(default="", max_length=2000)


class PatientProfileUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, max_length=150)
    date_of_birth: date | None = None
    age: int | None = Field(default=None, ge=0, le=120)
    gender: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    emergency_contact: str | None = Field(default=None, max_length=150)


class CareGapReviewUpdate(BaseModel):
    status: str
    assigned_to: str | None = Field(default=None, max_length=120)
    notes: str = Field(default="", max_length=2000)
    reviewer: str = Field(default="CareLens Reviewer", min_length=1, max_length=120)


class FollowUpCreate(BaseModel):
    patient_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=2000)
    due_date: date
    priority: str = "Medium"
    assigned_to: str | None = Field(default=None, max_length=120)


class FollowUpUpdate(BaseModel):
    status: str | None = None
    due_date: date | None = None
    assigned_to: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)

def _clean_records(df, mask=None):
    if df is None:
        return []
    selected = df if mask is None else df.loc[mask]
    selected = selected.astype(object).where(pd.notna(selected), None)
    return selected.to_dict(orient="records")


def _matches_id(series, value):
    return series.astype(str).str.strip() == str(value).strip()


def _manual_patient_dict(row):
    item = dict(row)
    item["id"] = f"MAN-{item['id']}"
    return item


def _get_manual_patient(patient_id: str):
    patient_id = str(patient_id).strip()
    if not patient_id.startswith("MAN-") or not patient_id[4:].isdigit():
        return None
    with get_db_connection() as connection:
        row = connection.execute("SELECT * FROM manual_patients WHERE id = ?", (int(patient_id[4:]),)).fetchone()
    return _manual_patient_dict(row) if row else None


def _get_patient_override(patient_id: str) -> dict:
    with get_db_connection() as connection:
        row = connection.execute("""
            SELECT first_name, last_name, name, date_of_birth, age, gender,
                   email, phone, address, emergency_contact
            FROM patient_profile_overrides WHERE patient_id = ?
        """, (str(patient_id),)).fetchone()
    return dict(row) if row else {}


def _apply_patient_override(patient: dict) -> dict:
    result = dict(patient)
    for key, value in _get_patient_override(str(result.get("id", ""))).items():
        if value is not None:
            result[key] = value
    return result


def _require_imported_patient(patient_id: str):
    data = load_data()
    patients = data.get("patients")
    if patients is None or "id" not in patients.columns:
        raise HTTPException(status_code=500, detail="Patient data or patient ID column is unavailable.")
    rows = patients.loc[_matches_id(patients["id"], patient_id)]
    if rows.empty:
        raise HTTPException(status_code=404, detail=f"Patient with ID '{patient_id}' was not found.")
    return data, _clean_records(rows)[0]


def patient_exists(patient_id: str) -> bool:
    if str(patient_id).startswith("MAN-"):
        return _get_manual_patient(patient_id) is not None
    data = load_data()
    patients = data.get("patients")
    if patients is None or "id" not in patients.columns:
        raise HTTPException(status_code=500, detail="Patient data or patient ID column is unavailable.")
    return bool(_matches_id(patients["id"], patient_id).any())


@app.get("/")
def home():
    return {"project": "CareLens", "status": "running"}


@app.get("/api/health")
def health():
    return {"status": "healthy"}


@app.get("/api/data/summary")
def data_summary():
    try:
        data = load_data()
        return {"files": {name: {"rows": int(df.shape[0]), "columns": int(df.shape[1]), "column_names": df.columns.tolist()} for name, df in data.items()}}
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/data/validation")
def data_validation():
    try:
        return {"algorithm": "Data Validation", "status": "completed", "report": validate_data(load_data())}
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/data/relationships")
def relationship_validation():
    try:
        return {"algorithm": "Data Validation", "check": "Referential Integrity", "report": validate_relationships(load_data())}
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/metrics")
def quality_metrics():
    try:
        return calculate_metrics(load_data())
    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/patients", status_code=201)
def add_patient(payload: ManualPatientCreate):
    name = payload.name.strip()
    first_name, last_name = payload.first_name.strip(), payload.last_name.strip()
    gender = payload.gender.strip()
    disease, department = payload.disease.strip(), payload.department.strip()
    phone, visit_notes = payload.phone.strip(), payload.visit_notes.strip()

    # Accept either a full name or first/last name fields and keep them consistent.
    if first_name or last_name:
        name = " ".join(part for part in (first_name, last_name) if part).strip()
    elif name:
        parts = name.split(maxsplit=1)
        first_name, last_name = parts[0], parts[1] if len(parts) > 1 else ""

    if not all((name, gender, disease, department)):
        raise HTTPException(status_code=422, detail="Name (or first/last name), gender, disease, and department are required.")
    if payload.date_of_birth and payload.date_of_birth > date.today():
        raise HTTPException(status_code=422, detail="Date of birth cannot be in the future.")
    if payload.next_visit_date and payload.next_visit_date < payload.visit_date:
        raise HTTPException(status_code=422, detail="Next visit date cannot be earlier than visit date.")
    try:
        with get_db_connection() as connection:
            cursor = connection.execute("""
                INSERT INTO manual_patients (
                    name, first_name, last_name, date_of_birth, age, gender,
                    email, phone, address, emergency_contact, disease, department,
                    visit_date, next_visit_date, visit_notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                name, first_name, last_name,
                payload.date_of_birth.isoformat() if payload.date_of_birth else None,
                payload.age, gender, payload.email.strip(), phone, payload.address.strip(),
                payload.emergency_contact.strip(), disease, department,
                payload.visit_date.isoformat(),
                payload.next_visit_date.isoformat() if payload.next_visit_date else None,
                visit_notes,
            ))
            patient_id = cursor.lastrowid
        patient = _get_manual_patient(f"MAN-{patient_id}")
        return {"message": "Patient added successfully.", "patient": patient}
    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=f"Could not save patient: {error}")


@app.get("/api/patients")
def list_patients(q: str = "", limit: int = Query(default=100, ge=1, le=500)):
    try:
        data = load_data()
        imported = data.get("patients")
        if imported is None or "id" not in imported.columns:
            raise HTTPException(status_code=500, detail="Patient table or ID column is unavailable.")
        imported_records = [_apply_patient_override(p) for p in _clean_records(imported)]
        with get_db_connection() as connection:
            manual_rows = connection.execute("SELECT * FROM manual_patients ORDER BY id DESC").fetchall()
        all_patients = imported_records + [_manual_patient_dict(row) for row in manual_rows]
        if q.strip():
            query = q.strip().casefold()
            all_patients = [p for p in all_patients if any(query in str(v).casefold() for v in p.values() if v is not None)]
        total = len(all_patients)
        return {"total": total, "patients": all_patients[:limit]}
    except HTTPException:
        raise
    except (FileNotFoundError, ValueError, sqlite3.Error) as error:
        raise HTTPException(status_code=500, detail=str(error))


@app.patch("/api/patients/{patient_id}")
def update_patient_profile(patient_id: str, payload: PatientProfileUpdate):
    patient_id = str(patient_id).strip()
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No patient profile fields were provided.")
    manual = _get_manual_patient(patient_id)
    if manual is None and patient_id.startswith("MAN-"):
        raise HTTPException(status_code=404, detail="Patient not found.")
    if manual is None:
        _, original = _require_imported_patient(patient_id)
        current = _apply_patient_override(original)
    else:
        current = manual

    if "first_name" in updates or "last_name" in updates:
        current_name = str(current.get("name") or "").strip()
        old_first = str(current.get("first_name") or "").strip()
        old_last = str(current.get("last_name") or "").strip()
        if not old_first and not old_last and current_name:
            parts = current_name.split(maxsplit=1)
            old_first, old_last = parts[0], parts[1] if len(parts) > 1 else ""
        first = str(updates.get("first_name", old_first) or "").strip()
        last = str(updates.get("last_name", old_last) or "").strip()
        updates["first_name"], updates["last_name"] = first, last
        updates["name"] = " ".join(part for part in (first, last) if part)
    elif updates.get("name") is not None:
        # If the full name is updated, synchronize the first and last name fields too.
        full_name = str(updates["name"] or "").strip()
        if not full_name:
            raise HTTPException(status_code=422, detail="Patient name cannot be empty.")
        parts = full_name.split(maxsplit=1)
        updates["name"] = full_name
        updates["first_name"] = parts[0]
        updates["last_name"] = parts[1] if len(parts) > 1 else ""
    for field in ("gender", "email", "phone", "address", "emergency_contact"):
        if field in updates and updates[field] is not None:
            updates[field] = updates[field].strip()
    if updates.get("date_of_birth") is not None:
        updates["date_of_birth"] = updates["date_of_birth"].isoformat()

    allowed = {"name", "first_name", "last_name", "date_of_birth", "age", "gender", "email", "phone", "address", "emergency_contact"}
    updates = {key: value for key, value in updates.items() if key in allowed}
    if manual is not None:
        if updates:
            assignments = ", ".join(f"{key} = ?" for key in updates)
            values = list(updates.values()) + [int(patient_id[4:])]
            with get_db_connection() as connection:
                connection.execute(f"UPDATE manual_patients SET {assignments} WHERE id = ?", values)
        updated = _get_manual_patient(patient_id)
    else:
        merged = {**_get_patient_override(patient_id), **updates}
        with get_db_connection() as connection:
            connection.execute("""
                INSERT INTO patient_profile_overrides (
                    patient_id, first_name, last_name, name, date_of_birth, age,
                    gender, email, phone, address, emergency_contact, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(patient_id) DO UPDATE SET
                    first_name=excluded.first_name, last_name=excluded.last_name,
                    name=excluded.name, date_of_birth=excluded.date_of_birth,
                    age=excluded.age, gender=excluded.gender, email=excluded.email,
                    phone=excluded.phone, address=excluded.address,
                    emergency_contact=excluded.emergency_contact, updated_at=CURRENT_TIMESTAMP
            """, (
                patient_id, merged.get("first_name"), merged.get("last_name"),
                merged.get("name"), merged.get("date_of_birth"), merged.get("age"),
                merged.get("gender"), merged.get("email"), merged.get("phone"),
                merged.get("address"), merged.get("emergency_contact"),
            ))
        _, original = _require_imported_patient(patient_id)
        updated = _apply_patient_override(original)
    return {"message": "Patient profile updated successfully.", "patient": updated}


@app.get("/api/patients/{patient_id}")
def patient_detail(patient_id: str):
    if patient_id.startswith("MAN-"):
        patient = _get_manual_patient(patient_id)
        if patient is None:
            raise HTTPException(status_code=404, detail=f"Patient with ID '{patient_id}' was not found.")
        empty = {"appointments": [], "medical_records": [], "lab_requests": [], "lab_results": [], "admissions": [], "billing": [], "care_gap_candidates": []}
        counts = {key: 0 for key in empty}
        return {"patient": patient, **empty, "record_counts": counts,
                "note": "This patient was manually registered. Imported clinical records and rule-based care-gap data are not linked automatically."}
    try:
        data, patient = _require_imported_patient(patient_id)
        patient = _apply_patient_override(patient)
        appointments = data.get("appointments", pd.DataFrame())
        medical = data.get("medical_records", pd.DataFrame())
        patient_appointments = appointments.loc[_matches_id(appointments["patient_id"], patient_id)] if "patient_id" in appointments.columns else appointments.iloc[0:0]
        patient_medical = medical.loc[_matches_id(medical["patient_id"], patient_id)] if "patient_id" in medical.columns else medical.iloc[0:0]
        lab_requests = data.get("lab_requests", pd.DataFrame())
        medical_ids = patient_medical["id"].astype(str).tolist() if "id" in patient_medical.columns else []
        patient_requests = lab_requests.loc[lab_requests["medical_record_id"].astype(str).isin(medical_ids)] if "medical_record_id" in lab_requests.columns else lab_requests.iloc[0:0]
        lab_results = data.get("lab_results", pd.DataFrame())
        request_ids = patient_requests["id"].astype(str).tolist() if "id" in patient_requests.columns else []
        patient_results = lab_results.loc[lab_results["request_id"].astype(str).isin(request_ids)] if "request_id" in lab_results.columns else lab_results.iloc[0:0]
        admissions = data.get("admissions", pd.DataFrame())
        patient_admissions = admissions.loc[_matches_id(admissions["patient_id"], patient_id)] if "patient_id" in admissions.columns else admissions.iloc[0:0]
        billing = data.get("billing", pd.DataFrame())
        patient_billing = billing.loc[_matches_id(billing["patient_id"], patient_id)] if "patient_id" in billing.columns else billing.iloc[0:0]
        worklist = build_care_gap_worklist(data)
        saved_reviews = get_reviews()
        patient_gaps = worklist.loc[worklist["patient_id"].notna() & _matches_id(worklist["patient_id"], patient_id)] if "patient_id" in worklist.columns else worklist.iloc[0:0]
        gaps = _clean_records(patient_gaps)
        for gap in gaps:
            saved = saved_reviews.get(str(gap["gap_id"]))
            if saved:
                gap.update(status=saved["status"], assigned_to=saved["assigned_to"], review_notes=saved["notes"], reviewer=saved["reviewer"], review_created_at=saved["created_at"], review_updated_at=saved["updated_at"])
            else:
                gap.update(assigned_to=None, review_notes="", reviewer=None, review_created_at=None, review_updated_at=None)
        collections = {
            "appointments": patient_appointments, "medical_records": patient_medical,
            "lab_requests": patient_requests, "lab_results": patient_results,
            "admissions": patient_admissions, "billing": patient_billing,
        }
        result = {key: _clean_records(frame) for key, frame in collections.items()}
        result["care_gap_candidates"] = gaps
        result["record_counts"] = {key: len(value) for key, value in result.items() if isinstance(value, list)}
        result["patient"] = patient
        result["note"] = "Care-gap candidates are rule-based flags and require human review; they are not confirmed clinical failures."
        return result
    except HTTPException:
        raise
    except (FileNotFoundError, pd.errors.ParserError, ValueError, KeyError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/care-gaps")
def detect_care_gaps():
    try:
        worklist = build_care_gap_worklist(load_data())
        reviews = get_reviews()
        candidates = _clean_records(worklist)
        for item in candidates:
            saved = reviews.get(str(item["gap_id"]))
            if saved:
                item.update(status=saved["status"], assigned_to=saved["assigned_to"], review_notes=saved["notes"], reviewer=saved["reviewer"], review_created_at=saved["created_at"], review_updated_at=saved["updated_at"])
            else:
                item.update(assigned_to=None, review_notes="", reviewer=None, review_created_at=None, review_updated_at=None)
        return {"algorithm": "Rule-Based Care Gap Detection", "total_flagged": len(candidates), "note": "Candidates require human review. Saved review statuses are preserved separately from rule-based detection.", "care_gaps": candidates}
    except (FileNotFoundError, pd.errors.ParserError, ValueError, KeyError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.patch("/api/care-gaps/{gap_id}/review")
def save_care_gap_review(gap_id: str, payload: CareGapReviewUpdate):
    if payload.status not in REVIEW_STATUSES:
        raise HTTPException(status_code=422, detail={"message": "Invalid review status.", "allowed_statuses": sorted(REVIEW_STATUSES)})
    try:
        worklist = build_care_gap_worklist(load_data())
        if gap_id not in set(worklist["gap_id"].astype(str)):
            raise HTTPException(status_code=404, detail="Care-gap candidate not found.")
        saved = update_review(gap_id=gap_id, status=payload.status, assigned_to=payload.assigned_to.strip() if payload.assigned_to else None, notes=payload.notes.strip(), reviewer=payload.reviewer.strip())
        return {"message": "Review saved successfully.", "review": saved}
    except HTTPException:
        raise
    except (FileNotFoundError, pd.errors.ParserError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/care-gaps/{gap_id}/history")
def care_gap_review_history(gap_id: str):
    try:
        worklist = build_care_gap_worklist(load_data())
        if gap_id not in set(worklist["gap_id"].astype(str)):
            raise HTTPException(status_code=404, detail="Care-gap candidate not found.")
        return {"gap_id": gap_id, "history": get_review_history(gap_id)}
    except HTTPException:
        raise
    except (FileNotFoundError, pd.errors.ParserError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/analytics/population")
def population_analytics():
    try:
        return build_population_analytics(load_data())
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/analytics/trends")
def operational_trends(period: str = "month"):
    if period not in {"month", "year"}:
        raise HTTPException(status_code=422, detail="period must be 'month' or 'year'.")
    try:
        return build_operational_trends(load_data(), period)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/analytics/insights")
def analytics_insights():
    try:
        return build_analytics_insights(load_data())
    except (FileNotFoundError, ValueError, KeyError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/analytics/attendance")
def attendance_analytics(group_by: str = "age", start_date: str | None = None, end_date: str | None = None, department: str | None = None, age_group: str | None = None, gender: str | None = None):
    try:
        return build_attendance_breakdown(load_data(), group_by=group_by, start_date=start_date, end_date=end_date, department=department, age_group=age_group, gender=gender)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/analytics/attendance-trends")
def attendance_trends(period: str = Query(default="month", pattern="^(month|year)$")):
    try:
        return build_attendance_trends(load_data(), period=period)
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error))


def followup_priority(due_date: str) -> str:
    due = date.fromisoformat(due_date)
    overdue = (date.today() - due).days
    if overdue >= 7:
        return "High"
    if overdue >= 3:
        return "Medium"
    if overdue >= 1:
        return "Low"
    return "Upcoming" if overdue < 0 else "Due Today"


def enrich_followup(item: dict) -> dict:
    result = dict(item)
    result["days_overdue"] = max(0, (date.today() - date.fromisoformat(result["due_date"])).days)
    result["alert_level"] = followup_priority(result["due_date"])
    return result


def calculate_followup_timing(due_date, status, today=None):
    today = today or date.today()
    if str(status).strip().lower() in {"completed", "closed", "cancelled"}:
        return {"days_overdue": 0, "timing_label": "Resolved", "is_overdue": False}
    try:
        due = date.fromisoformat(str(due_date)[:10])
    except (TypeError, ValueError):
        return {"days_overdue": 0, "timing_label": "Date unavailable", "is_overdue": False}
    overdue = max((today - due).days, 0)
    label = "Overdue" if overdue else ("Due Today" if due == today else "Upcoming")
    return {"days_overdue": overdue, "timing_label": label, "is_overdue": overdue > 0}


@app.get("/api/follow-ups")
def get_followups(include_closed: bool = False):
    return {"follow_ups": [enrich_followup(item) for item in list_followups(include_closed=include_closed)]}


@app.post("/api/follow-ups", status_code=201)
def add_followup(payload: FollowUpCreate):
    if payload.priority not in {"High", "Medium", "Low"}:
        raise HTTPException(status_code=422, detail="Priority must be High, Medium, or Low.")
    try:
        if not patient_exists(payload.patient_id):
            raise HTTPException(status_code=404, detail="Patient not found.")
        item = create_followup(patient_id=payload.patient_id, title=payload.title.strip(), reason=payload.reason.strip(), due_date=payload.due_date.isoformat(), priority=payload.priority, assigned_to=payload.assigned_to.strip() if payload.assigned_to else None)
        return {"follow_up": enrich_followup(item)}
    except HTTPException:
        raise
    except (ValueError, FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/follow-ups/{followup_id}")
def get_followup_details(followup_id: int):
    item = get_followup(followup_id)
    if not item:
        raise HTTPException(status_code=404, detail="Follow-up not found.")
    patient = patient_detail(item["patient_id"])
    return {"follow_up": enrich_followup(item), "patient": patient["patient"], "record_counts": patient["record_counts"]}


@app.patch("/api/follow-ups/{followup_id}")
def save_followup(followup_id: int, payload: FollowUpUpdate):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail={"message": "Invalid follow-up status.", "allowed_statuses": sorted(STATUSES)})
    if not get_followup(followup_id):
        raise HTTPException(status_code=404, detail="Follow-up not found.")
    item = update_followup(followup_id=followup_id, status=payload.status, assigned_to=payload.assigned_to.strip() if payload.assigned_to else None, notes=payload.notes.strip())
    return {"follow_up": enrich_followup(item)}


@app.get("/api/patients/{patient_id}/follow-ups")
def patient_followups(patient_id: str, include_closed: bool = True):
    if not patient_exists(patient_id):
        raise HTTPException(status_code=404, detail="Patient not found.")
    items = [enrich_followup(item) for item in list_followups(include_closed=include_closed) if str(item["patient_id"]) == str(patient_id)]
    return {"follow_ups": items}
