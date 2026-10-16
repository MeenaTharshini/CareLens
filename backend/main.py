
import sqlite3
from pathlib import Path
from datetime import date

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from followup_store import (
    STATUSES,
    list_followups,
    get_followup,
    create_followup,
    update_followup,
)

from review_store import (
    REVIEW_STATUSES,
    get_reviews,
    update_review,
    get_review_history,
)

from engine import (
    load_data,
    validate_data,
    validate_relationships,
    calculate_metrics,
    build_care_gap_worklist,
    build_population_analytics,
    build_operational_trends,
    build_analytics_insights,
    build_attendance_breakdown,
    build_attendance_trends,
)


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="CareLens API",
    description="Healthcare Quality and Care Gap Analytics",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://care-lens-roan.vercel.app",
        "https://care-lens-spra-luqwy80ce-meena-tharshini-is-projects.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# DATABASE FOR MANUALLY ADDED PATIENTS
# ============================================================

DB_PATH = Path(__file__).resolve().parent / "data" / "hospital.db"


def get_db_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_manual_patients_table():
    with get_db_connection() as connection:
        connection.execute(
            """
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
            """
        )


init_manual_patients_table()


# ============================================================
# PYDANTIC MODELS
# ============================================================

class ManualPatientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    age: int = Field(ge=0, le=120)
    gender: str = Field(min_length=1, max_length=30)
    phone: str = Field(default="", max_length=30)
    disease: str = Field(min_length=1, max_length=250)
    department: str = Field(min_length=1, max_length=100)
    visit_date: date
    next_visit_date: date | None = None
    visit_notes: str = Field(default="", max_length=2000)


class CareGapReviewUpdate(BaseModel):
    status: str
    assigned_to: str | None = Field(default=None, max_length=120)
    notes: str = Field(default="", max_length=2000)
    reviewer: str = Field(
        default="CareLens Reviewer",
        min_length=1,
        max_length=120,
    )


class FollowUpCreate(BaseModel):
    patient_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=2000)
    due_date: date
    priority: str = "Medium"
    assigned_to: str | None = Field(default=None, max_length=120)


class FollowUpUpdate(BaseModel):
    status: str
    assigned_to: str | None = Field(default=None, max_length=120)
    notes: str = Field(default="", max_length=2000)


# ============================================================
# SHARED HELPERS
# ============================================================

def _clean_records(df, mask=None):
    """Convert a DataFrame into JSON-safe records."""
    if df is None:
        return []

    selected = df if mask is None else df.loc[mask]
    selected = selected.astype(object).where(pd.notna(selected), None)

    return selected.to_dict(orient="records")


def _matches_id(series, value):
    """Compare identifiers safely as strings."""
    return series.astype(str).str.strip() == str(value).strip()


def _manual_patient_dict(row):
    """Convert a SQLite manual-patient row into an API record."""
    item = dict(row)
    item["id"] = f"MAN-{item['id']}"
    return item


def _get_manual_patient(patient_id: str):
    """Return a manual patient by MAN-prefixed or numeric ID."""
    patient_id = str(patient_id).strip()

    if not patient_id.startswith("MAN-"):
        return None

    raw_id = patient_id[4:]

    if not raw_id.isdigit():
        return None

    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT * FROM manual_patients WHERE id = ?",
            (int(raw_id),),
        ).fetchone()

    return _manual_patient_dict(row) if row else None


def patient_exists(patient_id: str) -> bool:
    """Check imported and manually added patient records."""
    if str(patient_id).startswith("MAN-"):
        return _get_manual_patient(patient_id) is not None

    data = load_data()
    patients = data.get("patients")

    if patients is None or "id" not in patients.columns:
        raise HTTPException(
            status_code=500,
            detail="Patient data or patient ID column is unavailable.",
        )

    return bool(_matches_id(patients["id"], patient_id).any())


def _require_imported_patient(patient_id: str):
    """Find an imported patient or raise 404."""
    data = load_data()
    patients = data.get("patients")

    if patients is None or "id" not in patients.columns:
        raise HTTPException(
            status_code=500,
            detail="Patient data or patient ID column is unavailable.",
        )

    rows = patients.loc[_matches_id(patients["id"], patient_id)]

    if rows.empty:
        raise HTTPException(
            status_code=404,
            detail=f"Patient with ID '{patient_id}' was not found.",
        )

    return data, _clean_records(rows)[0]


# ============================================================
# BASIC ROUTES
# ============================================================

@app.get("/")
def home():
    return {"project": "CareLens", "status": "running"}


@app.get("/api/health")
def health():
    return {"status": "healthy"}


# ============================================================
# DATA VALIDATION
# ============================================================

@app.get("/api/data/summary")
def data_summary():
    try:
        data = load_data()

        return {
            "files": {
                name: {
                    "rows": int(df.shape[0]),
                    "columns": int(df.shape[1]),
                    "column_names": df.columns.tolist(),
                }
                for name, df in data.items()
            }
        }

    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/data/validation")
def data_validation():
    try:
        return {
            "algorithm": "Data Validation",
            "status": "completed",
            "report": validate_data(load_data()),
        }

    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/data/relationships")
def relationship_validation():
    try:
        return {
            "algorithm": "Data Validation",
            "check": "Referential Integrity",
            "report": validate_relationships(load_data()),
        }

    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


# ============================================================
# QUALITY METRICS
# ============================================================

@app.get("/api/metrics")
def quality_metrics():
    try:
        return calculate_metrics(load_data())

    except (FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


# ============================================================
# PATIENTS: CREATE AND LIST
# ============================================================

@app.post("/api/patients", status_code=201)
def add_patient(payload: ManualPatientCreate):
    """Save a newly registered patient in the manual_patients table."""
    name = payload.name.strip()
    gender = payload.gender.strip()
    disease = payload.disease.strip()
    department = payload.department.strip()
    phone = payload.phone.strip()
    visit_notes = payload.visit_notes.strip()

    if not name or not gender or not disease or not department:
        raise HTTPException(
            status_code=422,
            detail="Name, gender, disease, and department are required.",
        )

    if (
        payload.next_visit_date is not None
        and payload.next_visit_date < payload.visit_date
    ):
        raise HTTPException(
            status_code=422,
            detail="Next visit date cannot be earlier than visit date.",
        )

    try:
        with get_db_connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO manual_patients (
                    name,
                    age,
                    gender,
                    phone,
                    disease,
                    department,
                    visit_date,
                    next_visit_date,
                    visit_notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    name,
                    payload.age,
                    gender,
                    phone,
                    disease,
                    department,
                    payload.visit_date.isoformat(),
                    (
                        payload.next_visit_date.isoformat()
                        if payload.next_visit_date
                        else None
                    ),
                    visit_notes,
                ),
            )

            patient_id = cursor.lastrowid

        return {
            "message": "Patient added successfully.",
            "patient": {
                "id": f"MAN-{patient_id}",
                "name": name,
                "age": payload.age,
                "gender": gender,
                "phone": phone,
                "disease": disease,
                "department": department,
                "visit_date": payload.visit_date.isoformat(),
                "next_visit_date": (
                    payload.next_visit_date.isoformat()
                    if payload.next_visit_date
                    else None
                ),
                "visit_notes": visit_notes,
            },
        }

    except sqlite3.Error as error:
        raise HTTPException(
            status_code=500,
            detail=f"Could not save patient: {error}",
        )


@app.get("/api/patients")
def list_patients(
    q: str = "",
    limit: int = Query(default=100, ge=1, le=500),
):
    """Return imported and manually added patients in one searchable list."""
    try:
        data = load_data()
        imported = data.get("patients")

        if imported is None or "id" not in imported.columns:
            raise HTTPException(
                status_code=500,
                detail="Patient table or ID column is unavailable.",
            )

        imported_records = _clean_records(imported)

        with get_db_connection() as connection:
            manual_rows = connection.execute(
                "SELECT * FROM manual_patients ORDER BY id DESC"
            ).fetchall()

        manual_records = [
            _manual_patient_dict(row) for row in manual_rows
        ]

        # Keep imported patients and manually created patients distinct.
        all_patients = imported_records + manual_records

        if q.strip():
            query = q.strip().casefold()

            def matches(record):
                return any(
                    query in str(value).casefold()
                    for value in record.values()
                    if value is not None
                )

            all_patients = [
                patient for patient in all_patients if matches(patient)
            ]

        total = len(all_patients)
        all_patients = all_patients[:limit]

        return {
            "total": total,
            "patients": all_patients,
        }

    except HTTPException:
        raise
    except (FileNotFoundError, ValueError, sqlite3.Error) as error:
        raise HTTPException(status_code=500, detail=str(error))


# ============================================================
# PATIENT 360 DETAILS
# ============================================================

@app.get("/api/patients/{patient_id}")
def patient_detail(patient_id: str):
    """Return imported Patient 360 data or a manual patient profile."""

    # Manually added patients do not automatically have imported
    # appointments, lab results, billing, or care-gap records.
    if patient_id.startswith("MAN-"):
        patient = _get_manual_patient(patient_id)

        if patient is None:
            raise HTTPException(
                status_code=404,
                detail=f"Patient with ID '{patient_id}' was not found.",
            )

        return {
            "patient": patient,
            "appointments": [],
            "medical_records": [],
            "lab_requests": [],
            "lab_results": [],
            "admissions": [],
            "billing": [],
            "care_gap_candidates": [],
            "record_counts": {
                "appointments": 0,
                "medical_records": 0,
                "lab_requests": 0,
                "lab_results": 0,
                "admissions": 0,
                "billing": 0,
                "care_gap_candidates": 0,
            },
            "note": (
                "This patient was manually registered. Imported clinical "
                "records and rule-based care-gap data are not linked "
                "automatically."
            ),
        }

    try:
        data, patient = _require_imported_patient(patient_id)

        appointments = data.get("appointments", pd.DataFrame())
        medical_records = data.get("medical_records", pd.DataFrame())

        patient_appointments = (
            appointments.loc[
                _matches_id(appointments["patient_id"], patient_id)
            ]
            if "patient_id" in appointments.columns
            else appointments.iloc[0:0]
        )

        patient_medical_records = (
            medical_records.loc[
                _matches_id(medical_records["patient_id"], patient_id)
            ]
            if "patient_id" in medical_records.columns
            else medical_records.iloc[0:0]
        )

        lab_requests = data.get("lab_requests", pd.DataFrame())

        medical_record_ids = (
            patient_medical_records["id"].astype(str).tolist()
            if "id" in patient_medical_records.columns
            else []
        )

        patient_lab_requests = (
            lab_requests.loc[
                lab_requests["medical_record_id"].astype(str).isin(
                    medical_record_ids
                )
            ]
            if "medical_record_id" in lab_requests.columns
            else lab_requests.iloc[0:0]
        )

        lab_results = data.get("lab_results", pd.DataFrame())

        request_ids = (
            patient_lab_requests["id"].astype(str).tolist()
            if "id" in patient_lab_requests.columns
            else []
        )

        patient_lab_results = (
            lab_results.loc[
                lab_results["request_id"].astype(str).isin(request_ids)
            ]
            if "request_id" in lab_results.columns
            else lab_results.iloc[0:0]
        )

        admissions = data.get("admissions", pd.DataFrame())
        billing = data.get("billing", pd.DataFrame())

        patient_admissions = (
            admissions.loc[
                _matches_id(admissions["patient_id"], patient_id)
            ]
            if "patient_id" in admissions.columns
            else admissions.iloc[0:0]
        )

        patient_billing = (
            billing.loc[
                _matches_id(billing["patient_id"], patient_id)
            ]
            if "patient_id" in billing.columns
            else billing.iloc[0:0]
        )

        worklist = build_care_gap_worklist(data)
        saved_reviews = get_reviews()

        if "patient_id" in worklist.columns:
            patient_gaps = worklist.loc[
                worklist["patient_id"].notna()
                & _matches_id(worklist["patient_id"], patient_id)
            ]
        else:
            patient_gaps = worklist.iloc[0:0]

        care_gap_candidates = _clean_records(patient_gaps)

        for gap in care_gap_candidates:
            saved = saved_reviews.get(str(gap["gap_id"]))

            if saved:
                gap["status"] = saved["status"]
                gap["assigned_to"] = saved["assigned_to"]
                gap["review_notes"] = saved["notes"]
                gap["reviewer"] = saved["reviewer"]
                gap["review_created_at"] = saved["created_at"]
                gap["review_updated_at"] = saved["updated_at"]
            else:
                gap["assigned_to"] = None
                gap["review_notes"] = ""
                gap["reviewer"] = None
                gap["review_created_at"] = None
                gap["review_updated_at"] = None

        return {
            "patient": patient,
            "appointments": _clean_records(patient_appointments),
            "medical_records": _clean_records(patient_medical_records),
            "lab_requests": _clean_records(patient_lab_requests),
            "lab_results": _clean_records(patient_lab_results),
            "admissions": _clean_records(patient_admissions),
            "billing": _clean_records(patient_billing),
            "care_gap_candidates": care_gap_candidates,
            "record_counts": {
                "appointments": len(patient_appointments),
                "medical_records": len(patient_medical_records),
                "lab_requests": len(patient_lab_requests),
                "lab_results": len(patient_lab_results),
                "admissions": len(patient_admissions),
                "billing": len(patient_billing),
                "care_gap_candidates": len(care_gap_candidates),
            },
            "note": (
                "Care-gap candidates are rule-based flags and require "
                "human review; they are not confirmed clinical failures."
            ),
        }

    except HTTPException:
        raise
    except (
        FileNotFoundError,
        pd.errors.ParserError,
        ValueError,
        KeyError,
    ) as error:
        raise HTTPException(status_code=400, detail=str(error))


# ============================================================
# CARE GAP DETECTION AND REVIEWS
# ============================================================

@app.get("/api/care-gaps")
def detect_care_gaps():
    try:
        worklist = build_care_gap_worklist(load_data())
        saved_reviews = get_reviews()
        candidates = worklist.to_dict(orient="records")

        for candidate in candidates:
            saved = saved_reviews.get(str(candidate["gap_id"]))

            if saved:
                candidate["status"] = saved["status"]
                candidate["assigned_to"] = saved["assigned_to"]
                candidate["review_notes"] = saved["notes"]
                candidate["reviewer"] = saved["reviewer"]
                candidate["review_created_at"] = saved["created_at"]
                candidate["review_updated_at"] = saved["updated_at"]
            else:
                candidate["assigned_to"] = None
                candidate["review_notes"] = ""
                candidate["reviewer"] = None
                candidate["review_created_at"] = None
                candidate["review_updated_at"] = None

        return {
            "algorithm": "Rule-Based Care Gap Detection",
            "total_flagged": len(candidates),
            "note": (
                "Candidates require human review. Saved review statuses "
                "are preserved separately from rule-based detection."
            ),
            "care_gaps": candidates,
        }

    except (
        FileNotFoundError,
        pd.errors.ParserError,
        ValueError,
        KeyError,
    ) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.patch("/api/care-gaps/{gap_id}/review")
def save_care_gap_review(gap_id: str, payload: CareGapReviewUpdate):
    if payload.status not in REVIEW_STATUSES:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Invalid review status.",
                "allowed_statuses": sorted(REVIEW_STATUSES),
            },
        )

    try:
        worklist = build_care_gap_worklist(load_data())

        if gap_id not in set(worklist["gap_id"].astype(str)):
            raise HTTPException(
                status_code=404,
                detail="Care-gap candidate not found.",
            )

        saved = update_review(
            gap_id=gap_id,
            status=payload.status,
            assigned_to=(
                payload.assigned_to.strip()
                if payload.assigned_to
                else None
            ),
            notes=payload.notes.strip(),
            reviewer=payload.reviewer.strip(),
        )

        return {
            "message": "Review saved successfully.",
            "review": saved,
        }

    except HTTPException:
        raise
    except (FileNotFoundError, pd.errors.ParserError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/care-gaps/{gap_id}/history")
def care_gap_review_history(gap_id: str):
    try:
        worklist = build_care_gap_worklist(load_data())

        if gap_id not in set(worklist["gap_id"].astype(str)):
            raise HTTPException(
                status_code=404,
                detail="Care-gap candidate not found.",
            )

        return {
            "gap_id": gap_id,
            "history": get_review_history(gap_id),
        }

    except HTTPException:
        raise
    except (FileNotFoundError, pd.errors.ParserError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


# ============================================================
# POPULATION AND OPERATIONAL ANALYTICS
# ============================================================

@app.get("/api/analytics/population")
def population_analytics():
    try:
        return build_population_analytics(load_data())

    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/analytics/trends")
def operational_trends(period: str = "month"):
    if period not in {"month", "year"}:
        raise HTTPException(
            status_code=422,
            detail="period must be 'month' or 'year'.",
        )

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
def attendance_analytics(
    group_by: str = "age",
    start_date: str | None = None,
    end_date: str | None = None,
    department: str | None = None,
    age_group: str | None = None,
    gender: str | None = None,
):
    try:
        return build_attendance_breakdown(
            load_data(),
            group_by=group_by,
            start_date=start_date,
            end_date=end_date,
            department=department,
            age_group=age_group,
            gender=gender,
        )

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/analytics/attendance-trends")
def attendance_trends(
    period: str = Query(
        default="month",
        pattern="^(month|year)$",
    ),
):
    try:
        return build_attendance_trends(load_data(), period=period)

    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error))


# ============================================================
# FOLLOW-UP HELPERS
# ============================================================

def followup_priority(due_date: str) -> str:
    due = date.fromisoformat(due_date)
    days_overdue = (date.today() - due).days

    if days_overdue >= 7:
        return "High"
    if days_overdue >= 3:
        return "Medium"
    if days_overdue >= 1:
        return "Low"

    return "Upcoming" if days_overdue < 0 else "Due Today"


def enrich_followup(item: dict) -> dict:
    result = dict(item)
    result["days_overdue"] = max(
        0,
        (date.today() - date.fromisoformat(result["due_date"])).days,
    )
    result["alert_level"] = followup_priority(result["due_date"])
    return result


def calculate_followup_timing(due_date, status, today=None):
    """Calculate due timing independently from stored priority."""
    today = today or date.today()

    if str(status).strip().lower() in {
        "completed",
        "closed",
        "cancelled",
    }:
        return {
            "days_overdue": 0,
            "timing_label": "Resolved",
            "is_overdue": False,
        }

    try:
        due = date.fromisoformat(str(due_date)[:10])
    except (TypeError, ValueError):
        return {
            "days_overdue": 0,
            "timing_label": "Date unavailable",
            "is_overdue": False,
        }

    days_overdue = max((today - due).days, 0)

    if days_overdue > 0:
        label = "Overdue"
    elif due == today:
        label = "Due Today"
    else:
        label = "Upcoming"

    return {
        "days_overdue": days_overdue,
        "timing_label": label,
        "is_overdue": days_overdue > 0,
    }


# ============================================================
# FOLLOW-UP ROUTES
# ============================================================

@app.get("/api/follow-ups")
def get_followups(include_closed: bool = False):
    return {
        "follow_ups": [
            enrich_followup(item)
            for item in list_followups(include_closed=include_closed)
        ]
    }


@app.post("/api/follow-ups", status_code=201)
def add_followup(payload: FollowUpCreate):
    if payload.priority not in {"High", "Medium", "Low"}:
        raise HTTPException(
            status_code=422,
            detail="Priority must be High, Medium, or Low.",
        )

    try:
        if not patient_exists(payload.patient_id):
            raise HTTPException(status_code=404, detail="Patient not found.")

        item = create_followup(
            patient_id=payload.patient_id,
            title=payload.title.strip(),
            reason=payload.reason.strip(),
            due_date=payload.due_date.isoformat(),
            priority=payload.priority,
            assigned_to=(
                payload.assigned_to.strip()
                if payload.assigned_to
                else None
            ),
        )

        return {"follow_up": enrich_followup(item)}

    except HTTPException:
        raise
    except (ValueError, FileNotFoundError, pd.errors.ParserError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/follow-ups/{followup_id}")
def get_followup_details(followup_id: int):
    item = get_followup(followup_id)

    if not item:
        raise HTTPException(
            status_code=404,
            detail="Follow-up not found.",
        )

    patient = patient_detail(item["patient_id"])

    return {
        "follow_up": enrich_followup(item),
        "patient": patient["patient"],
        "record_counts": patient["record_counts"],
    }


@app.patch("/api/follow-ups/{followup_id}")
def save_followup(followup_id: int, payload: FollowUpUpdate):
    if payload.status not in STATUSES:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Invalid follow-up status.",
                "allowed_statuses": sorted(STATUSES),
            },
        )

    if not get_followup(followup_id):
        raise HTTPException(
            status_code=404,
            detail="Follow-up not found.",
        )

    item = update_followup(
        followup_id=followup_id,
        status=payload.status,
        assigned_to=(
            payload.assigned_to.strip()
            if payload.assigned_to
            else None
        ),
        notes=payload.notes.strip(),
    )

    return {"follow_up": enrich_followup(item)}


@app.get("/api/patients/{patient_id}/follow-ups")
def patient_followups(
    patient_id: str,
    include_closed: bool = True,
):
    if not patient_exists(patient_id):
        raise HTTPException(
            status_code=404,
            detail="Patient not found.",
        )

    items = [
        enrich_followup(item)
        for item in list_followups(include_closed=include_closed)
        if str(item["patient_id"]) == str(patient_id)
    ]

    return {"follow_ups": items}