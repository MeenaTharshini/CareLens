from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"

FILES = [
    "patients.csv",
    "appointments.csv",
    "medical_records.csv",
    "departments.csv",
    "lab_requests.csv",
    "lab_results.csv",
]

RELATIONSHIPS = [
    ("appointments", "patient_id", "patients", "id"),
    ("medical_records", "patient_id", "patients", "id"),
    ("lab_requests", "medical_record_id", "medical_records", "id"),
    ("lab_results", "request_id", "lab_requests", "id"),
]


def load_data():
    """Load the six CSV datasets into a dictionary of DataFrames."""
    data = {}

    for filename in FILES:
        path = DATA_DIR / filename

        if not path.exists():
            raise FileNotFoundError(f"Missing dataset file: {filename}")

        data[filename.removesuffix(".csv")] = pd.read_csv(path)

    return data


def _normalize_status(series):
    """Normalize status values for consistent rule evaluation."""
    return series.fillna("").astype(str).str.strip().str.lower()


def _id_set(series):
    """Normalize non-null IDs for relationship comparisons."""
    return set(series.dropna().astype(str).str.strip())


def validate_data(data):
    """Report missing cells, duplicate rows, duplicate IDs and invalid statuses."""
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
    """Check missing and unmatched foreign keys."""
    report = []

    for source_name, source_col, target_name, target_col in RELATIONSHIPS:
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
                "passed" if missing == 0 and unmatched == 0
                else "review_required"
            ),
        })

    return report



def calculate_metrics(data):
    """Calculate descriptive measures and report turnaround data quality."""
    appointments = data["appointments"]
    requests = data["lab_requests"]
    results = data["lab_results"]

    # 1. Appointment measures
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

    # 2. Lab result availability: count each request only once.
    result_ids = _id_set(results["request_id"])
    request_ids = requests["id"].astype(str).str.strip()

    linked_count = int(request_ids.isin(result_ids).sum())
    total_requests = len(requests)

    availability_rate = (
        linked_count / total_requests * 100
        if total_requests else 0.0
    )

    # 3. Turnaround: first valid result per request.
    request_dates = requests[["id", "request_date"]].copy()
    result_dates = results[["request_id", "performed_date"]].copy()

    request_dates["_request_key"] = (
        request_dates["id"].astype("string").str.strip()
    )
    result_dates["_request_key"] = (
        result_dates["request_id"].astype("string").str.strip()
    )

    # Do not join missing IDs to one another.
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

    # One observation per request: its earliest valid result turnaround.
    first_turnaround = valid_pairs.groupby(
        "_request_key"
    )["_elapsed_days"].min()

    median_days = (
        round(float(first_turnaround.median()), 2)
        if not first_turnaround.empty else None
    )

    # 4. Data completeness across all loaded tables.
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
        "data_completeness_percent": round(completeness, 2),
        "total_missing_cells": missing_cells,
    }

def build_care_gap_worklist(data):
    """Return a standardized review worklist for the dashboard."""
    appointments = data["appointments"]
    requests = data["lab_requests"]
    results = data["lab_results"]
    records = data["medical_records"]

    gaps = []

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

    result_ids = _id_set(results["request_id"])
    missing_results = requests[
        requests["id"].notna()
        & ~requests["id"].astype(str).str.strip().isin(result_ids)
    ]

    patient_by_record = {}
    if {"id", "patient_id"}.issubset(records.columns):
        patient_by_record = dict(
            zip(records["id"].astype(str).str.strip(),
                records["patient_id"])
        )

    for _, row in missing_results.iterrows():
        record_id = str(row["id"])
        medical_record_id = (
            str(row["medical_record_id"]).strip()
            if pd.notna(row.get("medical_record_id")) else None
        )

        patient_id = patient_by_record.get(medical_record_id)

        gaps.append({
            "gap_id": f"lab_result_missing:{record_id}",
            "rule_id": "LAB_RESULT_NOT_LINKED",
            "gap_type": "Lab result not linked",
            "record_id": record_id,
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
