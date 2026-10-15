
from pathlib import Path
import sqlite3

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "hospital.db"

# Tables used by the current quality analytics engine.
TABLES = [
    "patients",
    "appointments",
    "medical_records",
    "departments",
    "lab_requests",
    "lab_results",
    "admissions",
    "billing",
    "beds",
]

# Relationships used for explicit data-quality checks.
RELATIONSHIPS = [
    ("appointments", "patient_id", "patients", "id"),
    ("medical_records", "patient_id", "patients", "id"),
    ("lab_requests", "medical_record_id", "medical_records", "id"),
    ("lab_results", "request_id", "lab_requests", "id"),
    ("admissions", "patient_id", "patients", "id"),
    ("billing", "patient_id", "patients", "id"),
]


def load_data():
    """Load selected SQLite tables as DataFrames."""
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")

    data = {}

    with sqlite3.connect(DB_PATH) as connection:
        existing = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }

        for table in TABLES:
            if table not in existing:
                raise ValueError(f"Required database table is missing: {table}")

            # Table names come only from the fixed TABLES allowlist.
            data[table] = pd.read_sql_query(
                f'SELECT * FROM "{table}"', connection
            )

    return data


def _normalize_status(series):
    """Normalize status values for consistent rule evaluation."""
    return series.fillna("").astype(str).str.strip().str.lower()


def _id_set(series):
    """Normalize non-null IDs for relationship comparisons."""
    return set(series.dropna().astype(str).str.strip())


def validate_data(data):
    """Report missing cells, duplicate rows/IDs, and unknown appointment statuses."""
    report = {}

    for name, df in data.items():
        missing_by_column = df.isna().sum()
        duplicate_ids = 0

        if "id" in df.columns:
            ids = df["id"].dropna().astype(str).str.strip()
            duplicate_ids = int(ids.duplicated().sum())

        item = {
            "total_rows": int(len(df)),
            "total_columns": int(len(df.columns)),
            "missing_cells": int(df.isna().sum().sum()),
            "missing_by_column": {
                col: int(count)
                for col, count in missing_by_column.items()
                if count > 0
            },
            "duplicate_rows": int(df.duplicated().sum()),
            "duplicate_ids": duplicate_ids,
        }

        if name == "appointments" and "status" in df.columns:
            statuses = _normalize_status(df["status"])
            allowed = {
                "completed", "cancelled", "no_show",
                "scheduled", "pending",
            }
            observed = set(statuses) - {""}
            item["unknown_statuses"] = sorted(observed - allowed)
            item["missing_statuses"] = int((statuses == "").sum())

        report[name] = item

    return report


def validate_relationships(data):
    """Check missing and unmatched foreign keys in selected relationships."""
    report = []

    
    for source_name, source_col, target_name, target_col in RELATIONSHIPS:
    # Older unit tests may provide only a subset of the tables.
        if source_name not in data or target_name not in data:
            continue

        source = data[source_name]
        target = data[target_name]

        if source_col not in source.columns or target_col not in target.columns:
            report.append({
                "relationship": (
                    f"{source_name}.{source_col} -> "
                    f"{target_name}.{target_col}"
                ),
                "status": "invalid_schema",
            })
            continue

        target_ids = _id_set(target[target_col])
        source_values = source[source_col]
        non_null_values = source_values.dropna().astype(str).str.strip()

        unmatched = int((~non_null_values.isin(target_ids)).sum())
        missing = int(source_values.isna().sum())

        report.append({
            "relationship": (
                f"{source_name}.{source_col} -> "
                f"{target_name}.{target_col}"
            ),
            "source_records": int(len(source)),
            "missing_foreign_keys": missing,
            "unmatched_foreign_keys": unmatched,
            "status": (
                "passed"
                if missing == 0 and unmatched == 0
                else "review_required"
            ),
        })

    return report


def calculate_metrics(data):
    """Calculate descriptive operational quality measures."""
    
    appointments = data["appointments"]
    requests = data["lab_requests"]
    results = data["lab_results"]

# Admission and billing data are optional for smaller test datasets.
    admissions = data.get(
        "admissions",
        pd.DataFrame(columns=["admission_date", "discharge_date"]),
    )
    billing = data.get(
        "billing",
        pd.DataFrame(columns=["total_amount", "paid_amount"]),
    )


    # Appointment measures
    status = _normalize_status(appointments["status"])

    total_appointments = len(appointments)
    completed = int((status == "completed").sum())
    no_shows = int((status == "no_show").sum())
    eligible = completed + no_shows

    completion_rate = (
        completed / total_appointments * 100
        if total_appointments else 0.0
    )
    no_show_rate = (
        no_shows / eligible * 100
        if eligible else 0.0
    )

    # Lab result availability: requests with at least one linked result.
    result_ids = _id_set(results["request_id"])
    request_ids = requests["id"].astype(str).str.strip()
    linked_count = int(request_ids.isin(result_ids).sum())
    total_requests = len(requests)

    availability_rate = (
        linked_count / total_requests * 100
        if total_requests else 0.0
    )

    # Lab turnaround time. Use the earliest valid result per request.
    request_dates = requests[["id", "request_date"]].copy()
    result_dates = results[["request_id", "performed_date"]].copy()

    request_dates["_request_key"] = (
        request_dates["id"].astype("string").str.strip()
    )
    result_dates["_request_key"] = (
        result_dates["request_id"].astype("string").str.strip()
    )

    request_dates = request_dates[
        request_dates["_request_key"].notna()
        & request_dates["_request_key"].ne("")
    ]
    result_dates = result_dates[
        result_dates["_request_key"].notna()
        & result_dates["_request_key"].ne("")
    ]

    pairs = request_dates.merge(
        result_dates,
        on="_request_key",
        how="inner",
        suffixes=("_request", "_result"),
    )

    requested_at = pd.to_datetime(
        pairs["request_date"], errors="coerce"
    )
    performed_at = pd.to_datetime(
        pairs["performed_date"], errors="coerce"
    )

    elapsed_days = (
        (performed_at - requested_at).dt.total_seconds() / 86400
    )

    invalid_date_pairs = int(
        (requested_at.isna() | performed_at.isna()).sum()
    )
    negative_turnaround_pairs = int(
        (elapsed_days < 0).fillna(False).sum()
    )

    pairs["_elapsed_days"] = elapsed_days
    valid_pairs = pairs[
        pairs["_elapsed_days"].notna()
        & (pairs["_elapsed_days"] >= 0)
    ]

    first_turnaround = valid_pairs.groupby(
        "_request_key"
    )["_elapsed_days"].min()

    median_days = (
        round(float(first_turnaround.median()), 2)
        if not first_turnaround.empty else None
    )

    # Admission length of stay; negative or invalid durations are excluded.
    admission_dates = pd.to_datetime(
        admissions["admission_date"], errors="coerce"
    )
    discharge_dates = pd.to_datetime(
        admissions["discharge_date"], errors="coerce"
    )
    stay_days = (
        (discharge_dates - admission_dates).dt.total_seconds() / 86400
    )
    valid_stays = stay_days[
        stay_days.notna() & (stay_days >= 0)
    ]

    # Billing balance; clamp negative balances to zero for this measure.
    total_billed = pd.to_numeric(
        billing["total_amount"], errors="coerce"
    ).fillna(0).sum()
    total_paid = pd.to_numeric(
        billing["paid_amount"], errors="coerce"
    ).fillna(0).sum()
    outstanding_balance = max(float(total_billed - total_paid), 0.0)

    total_cells = sum(df.size for df in data.values())
    missing_cells = sum(
        int(df.isna().sum().sum()) for df in data.values()
    )
    completeness = (
        (total_cells - missing_cells) / total_cells * 100
        if total_cells else 0.0
    )

    return {
        "appointment_completion_rate_percent": round(
            completion_rate, 2
        ),
        "appointment_no_show_rate_percent": round(no_show_rate, 2),
        "completed_appointments": completed,
        "recorded_no_shows": no_shows,
        "all_appointment_records": total_appointments,
        "no_show_rate_denominator": eligible,
        "lab_result_availability_percent": round(
            availability_rate, 2
        ),
        "lab_requests_with_linked_results": linked_count,
        "total_lab_requests": total_requests,
        "median_lab_turnaround_days": median_days,
        "valid_lab_turnaround_requests": int(len(first_turnaround)),
        "invalid_lab_date_pairs": invalid_date_pairs,
        "negative_lab_turnaround_pairs": negative_turnaround_pairs,
        "median_admission_length_of_stay_days": (
            round(float(valid_stays.median()), 2)
            if not valid_stays.empty else None
        ),
        "admissions_with_valid_stay": int(len(valid_stays)),
        "total_billed_amount": round(float(total_billed), 2),
        "total_paid_amount": round(float(total_paid), 2),
        "estimated_outstanding_balance": round(
            outstanding_balance, 2
        ),
        "data_completeness_percent": round(completeness, 2),
        "total_missing_cells": missing_cells,
    }


def build_care_gap_worklist(data):
    """Build an evidence-based operational review worklist."""
    appointments = data["appointments"]
    requests = data["lab_requests"]
    results = data["lab_results"]
    records = data["medical_records"]

    gaps = []

    # Flag recorded no-shows for staff review.
    statuses = _normalize_status(appointments["status"])
    no_shows = appointments[statuses == "no_show"]

    for _, row in no_shows.iterrows():
        record_id = str(row["id"])

        gaps.append({
            "gap_id": f"appointment_no_show:{record_id}",
            "rule_id": "APPOINTMENT_NO_SHOW",
            "gap_type": "Recorded appointment no-show",
            "record_id": record_id,
            "patient_id": (
                str(row["patient_id"])
                if pd.notna(row.get("patient_id")) else None
            ),
            "event_date": str(row["appointment_date"]),
            "evidence": "Appointment status is no_show",
            "status": "Pending Review",
            "priority": "Review",
        })

    # Flag lab requests without a linked result.
    result_ids = _id_set(results["request_id"])
    request_ids = requests["id"].astype(str).str.strip()

    missing_results = requests[
        requests["id"].notna()
        & ~request_ids.isin(result_ids)
    ]

    patient_by_record = {}
    if {"id", "patient_id"}.issubset(records.columns):
        patient_by_record = dict(
            zip(
                records["id"].astype(str).str.strip(),
                records["patient_id"],
            )
        )

    for _, row in missing_results.iterrows():
        request_id = str(row["id"])
        medical_record_id = (
            str(row["medical_record_id"]).strip()
            if pd.notna(row.get("medical_record_id")) else None
        )

        patient_id = patient_by_record.get(medical_record_id)

        gaps.append({
            "gap_id": f"lab_result_missing:{request_id}",
            "rule_id": "LAB_RESULT_NOT_LINKED",
            "gap_type": "Lab result not linked",
            "record_id": request_id,
            "patient_id": (
                str(patient_id) if pd.notna(patient_id) else None
            ),
            "event_date": str(row["request_date"]),
            "evidence": "No lab result references this request ID",
            "status": "Pending Review",
            "priority": "Review",
        })

    columns = [
        "gap_id", "rule_id", "gap_type", "record_id", "patient_id",
        "event_date", "evidence", "status", "priority",
    ]

    return pd.DataFrame(gaps, columns=columns)
