
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
    "doctors",
    "staff",
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
    """Build a transparent operational care-gap review worklist."""
    appointments = data.get("appointments", pd.DataFrame())
    requests = data.get("lab_requests", pd.DataFrame())
    results = data.get("lab_results", pd.DataFrame())
    records = data.get("medical_records", pd.DataFrame())

    gaps = []

    # Map medical records to patients when the required columns exist.
    patient_by_record = {}

    if {"id", "patient_id"}.issubset(records.columns):
        valid_records = records.dropna(subset=["id"]).copy()
        patient_by_record = dict(
            zip(
                valid_records["id"].astype(str).str.strip(),
                valid_records["patient_id"],
            )
        )

    # Rule 1: Recorded appointment no-shows need follow-up review.
    if {"id", "status"}.issubset(appointments.columns):
        statuses = _normalize_status(appointments["status"])
        no_shows = appointments[statuses.isin(
            {"no_show", "no-show", "no show", "noshow"}
        )]

        for _, row in no_shows.iterrows():
            record_id = str(row["id"])
            patient_value = row.get("patient_id")

            gaps.append({
                "gap_id": f"appointment_no_show:{record_id}",
                "rule_id": "APPOINTMENT_NO_SHOW",
                "gap_type": "Recorded appointment no-show",
                "record_id": record_id,
                "patient_id": (
                    str(patient_value)
                    if pd.notna(patient_value) else None
                ),
                "event_date": (
                    str(row.get("appointment_date"))
                    if pd.notna(row.get("appointment_date"))
                    else None
                ),
                "evidence": "Appointment status is recorded as no-show.",
                "status": "Pending Review",
                "priority": "Medium",
                "priority_reason": (
                    "Follow-up review is needed to establish whether "
                    "rescheduling or outreach is appropriate."
                ),
                "recommended_action": (
                    "Verify the appointment outcome and consider "
                    "contacting the patient or arranging follow-up."
                ),
            })

    # Rule 2: Lab requests without a linked result need verification.
    if "id" in requests.columns:
        if "request_id" in results.columns:
            result_ids = _id_set(results["request_id"])
        else:
            result_ids = set()

        request_ids = requests["id"].astype("string").str.strip()

        missing_results = requests[
            requests["id"].notna()
            & ~request_ids.isin(result_ids)
        ]

        for _, row in missing_results.iterrows():
            request_id = str(row["id"])
            medical_record_id = (
                str(row["medical_record_id"]).strip()
                if pd.notna(row.get("medical_record_id"))
                else None
            )

            patient_id = patient_by_record.get(medical_record_id)

            gaps.append({
                "gap_id": f"lab_result_missing:{request_id}",
                "rule_id": "LAB_RESULT_NOT_LINKED",
                "gap_type": "Lab result not linked",
                "record_id": request_id,
                "patient_id": (
                    str(patient_id)
                    if pd.notna(patient_id) else None
                ),
                "event_date": (
                    str(row.get("request_date"))
                    if pd.notna(row.get("request_date"))
                    else None
                ),
                "evidence": (
                    "No lab result references this request ID. "
                    "The result may exist outside the linked records."
                ),
                "status": "Pending Review",
                "priority": "High",
                "priority_reason": (
                    "Result linkage must be verified to establish "
                    "whether the request has been completed and documented."
                ),
                "recommended_action": (
                    "Check the laboratory system and request status, "
                    "then link the result or document the outstanding request."
                ),
            })

    columns = [
        "gap_id",
        "rule_id",
        "gap_type",
        "record_id",
        "patient_id",
        "event_date",
        "evidence",
        "status",
        "priority",
        "priority_reason",
        "recommended_action",
    ]

    worklist = pd.DataFrame(gaps, columns=columns)

    # Keep higher-priority items at the top of the review list.
    priority_order = {"High": 0, "Medium": 1, "Low": 2}
    if not worklist.empty:
        worklist["_priority_order"] = (
            worklist["priority"].map(priority_order).fillna(3)
        )
        worklist = (
            worklist.sort_values(
                ["_priority_order", "event_date"],
                ascending=[True, True],
                na_position="last",
            )
            .drop(columns=["_priority_order"])
            .reset_index(drop=True)
        )

    return worklist


def build_population_analytics(data):
    """Compare appointment quality measures across departments."""
    required = {
        "appointments": {"id", "doctor_id", "status"},
        "doctors": {"id", "staff_id"},
        "staff": {"id", "department_id"},
        "departments": {"id", "name"},
    }

    for table, columns in required.items():
        if table not in data:
            return {
                "group_by": "department",
                "available": False,
                "message": f"Required table '{table}' is unavailable.",
                "groups": [],
            }

        missing = columns - set(data[table].columns)
        if missing:
            return {
                "group_by": "department",
                "available": False,
                "message": (
                    f"Table '{table}' is missing columns: "
                    f"{sorted(missing)}"
                ),
                "groups": [],
            }

    appointments = data["appointments"].copy()

    if appointments.empty:
        return {
            "group_by": "department",
            "available": False,
            "message": "No appointment records are available.",
            "groups": [],
        }

    # Select only the columns needed for each join.
    doctors = data["doctors"][["id", "staff_id"]].rename(
        columns={"id": "doctor_id"}
    )

    staff = data["staff"][["id", "department_id"]].rename(
        columns={"id": "staff_id"}
    )

    departments = data["departments"][["id", "name"]].rename(
        columns={"id": "department_id", "name": "department"}
    )

    # appointments -> doctors -> staff -> departments
    joined = appointments.merge(
        doctors,
        on="doctor_id",
        how="left",
        validate="many_to_one",
    )

    joined = joined.merge(
        staff,
        on="staff_id",
        how="left",
        validate="many_to_one",
    )

    joined = joined.merge(
        departments,
        on="department_id",
        how="left",
        validate="many_to_one",
    )

    joined["department"] = (
        joined["department"]
        .fillna("Unknown department")
        .astype(str)
        .str.strip()
        .replace("", "Unknown department")
    )

    joined["_status"] = _normalize_status(joined["status"])

    groups = []

    for department, group in joined.groupby(
        "department", dropna=False
    ):
        total = len(group)
        completed = int((group["_status"] == "completed").sum())
        no_shows = int((group["_status"] == "no_show").sum())
        eligible = completed + no_shows

        groups.append({
            "department": str(department),
            "total_appointments": int(total),
            "completed_appointments": completed,
            "recorded_no_shows": no_shows,
            "completion_rate_percent": round(
                completed / total * 100, 2
            ) if total else None,
            "no_show_rate_percent": round(
                no_shows / eligible * 100, 2
            ) if eligible else None,
            "no_show_denominator": eligible,
        })

    groups.sort(
        key=lambda item: item["total_appointments"],
        reverse=True,
    )

    unknown_count = int(
        (joined["department"] == "Unknown department").sum()
    )

    return {
        "group_by": "department",
        "available": True,
        "total_appointments": int(len(joined)),
        "departments_count": len(groups),
        "appointments_without_department_mapping": unknown_count,
        "groups": groups,
        "metric_definitions": {
            "completion_rate_percent": (
                "Completed appointments / all appointments * 100"
            ),
            "no_show_rate_percent": (
                "Recorded no-shows / (completed appointments + "
                "recorded no-shows) * 100"
            ),
        },
        "note": (
            "These are descriptive operational measures, not proof "
            "of clinical quality. Unknown department mappings are "
            "reported separately. No-show rate excludes other statuses."
        ),
    }


def build_operational_trends(data, period="month"):
    """Aggregate appointment and lab-request counts over time."""
    if period not in {"month", "year"}:
        raise ValueError("period must be 'month' or 'year'.")

    output = {}

    sources = [
        ("appointments", "appointment_date", "appointments"),
        ("lab_requests", "request_date", "lab_requests"),
    ]

    for table_name, date_col, output_key in sources:
        df = data.get(table_name, pd.DataFrame())

        if date_col not in df.columns:
            output[output_key] = {
                "available": False,
                "message": f"Column '{date_col}' is unavailable.",
                "points": [],
            }
            continue

        dates = pd.to_datetime(df[date_col], errors="coerce")
        valid_dates = dates.dropna()

        if valid_dates.empty:
            output[output_key] = {
                "available": False,
                "message": "No valid dates are available.",
                "points": [],
            }
            continue

        if period == "month":
            keys = valid_dates.dt.to_period("M").astype(str)
        else:
            keys = valid_dates.dt.to_period("Y").astype(str)

        counts = keys.value_counts().sort_index()

        output[output_key] = {
            "available": True,
            "points": [
                {"period": str(key), "count": int(value)}
                for key, value in counts.items()
            ],
            "records_with_invalid_dates": int(dates.isna().sum()),
        }

    return {
        "period": period,
        "trends": output,
        "note": (
            "Counts show recorded activity, not necessarily changes "
            "in patient outcomes or care quality."
        ),
    }


def build_analytics_insights(data):
    """Generate transparent observations from existing KPI calculations."""
    metrics = calculate_metrics(data)
    insights = []

    no_show_rate = metrics["appointment_no_show_rate_percent"]
    if metrics["no_show_rate_denominator"] > 0:
        insights.append({
            "id": "appointment_no_show_rate",
            "title": "Recorded appointment no-shows",
            "value_percent": no_show_rate,
            "evidence": (
                f'{metrics["recorded_no_shows"]} recorded no-shows out of '
                f'{metrics["no_show_rate_denominator"]} completed or '
                "no-show appointments."
            ),
            "interpretation": (
                "Review scheduling patterns and follow-up processes. "
                "This metric alone does not establish why patients missed "
                "appointments."
            ),
        })

    missing_results = (
        metrics["total_lab_requests"]
        - metrics["lab_requests_with_linked_results"]
    )
    if metrics["total_lab_requests"] > 0:
        insights.append({
            "id": "lab_result_linkage",
            "title": "Lab requests without linked results",
            "count": missing_results,
            "evidence": (
                f'{metrics["lab_requests_with_linked_results"]} of '
                f'{metrics["total_lab_requests"]} requests have a linked '
                "lab result."
            ),
            "interpretation": (
                "Review outstanding requests and result-linkage integrity. "
                "An absent linked result does not prove that a test was "
                "not performed."
            ),
        })

    if metrics["invalid_lab_date_pairs"] or metrics[
        "negative_lab_turnaround_pairs"
    ]:
        insights.append({
            "id": "lab_date_quality",
            "title": "Lab date pairs need validation",
            "count": (
                metrics["invalid_lab_date_pairs"]
                + metrics["negative_lab_turnaround_pairs"]
            ),
            "evidence": (
                f'{metrics["invalid_lab_date_pairs"]} pairs have invalid '
                f'dates; {metrics["negative_lab_turnaround_pairs"]} have '
                "negative turnaround durations."
            ),
            "interpretation": (
                "Validate request and performed dates before relying on "
                "turnaround-time summaries."
            ),
        })

    return {
        "insight_count": len(insights),
        "insights": insights,
        "note": (
            "Rule-based observations for operational review, not "
            "automated clinical diagnoses or treatment recommendations."
        ),
    }


def build_attendance_breakdown(
    data,
    group_by="age",
    start_date=None,
    end_date=None,
    department=None,
    age_group=None,
    gender=None,
):
    """Break down attendance and apply filters before aggregation."""

    allowed_groups = {"age", "gender", "disease", "department"}

    if group_by not in allowed_groups:
        raise ValueError(
            "group_by must be age, gender, disease, or department."
        )

    appointments = data.get("appointments", pd.DataFrame()).copy()
    patients = data.get("patients", pd.DataFrame()).copy()

    def unavailable(message):
        return {
            "available": False,
            "group_by": group_by,
            "message": message,
            "groups": [],
        }

    required = {"id", "patient_id", "status"}
    if not required.issubset(appointments.columns):
        return unavailable(
            "Appointments must contain id, patient_id, and status."
        )

    if "id" not in patients.columns:
        return unavailable("Patients table must contain an id column.")

    # Normalize IDs so numeric and text IDs can be matched.
    appointments["_patient_key"] = (
        appointments["patient_id"].astype("string").str.strip()
    )
    patients["_patient_key"] = (
        patients["id"].astype("string").str.strip()
    )

    appointments = appointments[
        appointments["_patient_key"].notna()
        & appointments["_patient_key"].ne("")
    ].copy()

    # Filter by appointment date.
    if start_date or end_date:
        if "appointment_date" not in appointments.columns:
            return unavailable(
                "Appointment dates are unavailable for date filtering."
            )

        dates = pd.to_datetime(
            appointments["appointment_date"], errors="coerce"
        )

        if start_date:
            start = pd.to_datetime(start_date, errors="coerce")
            if pd.isna(start):
                raise ValueError("Invalid start_date. Use YYYY-MM-DD.")
            dates_start = start.normalize()
            appointments = appointments[dates >= dates_start]

        if end_date:
            end = pd.to_datetime(end_date, errors="coerce")
            if pd.isna(end):
                raise ValueError("Invalid end_date. Use YYYY-MM-DD.")
            dates_end = end.normalize() + pd.Timedelta(days=1)
            appointments = appointments[dates < dates_end]

    # Add patient attributes for age and gender filters.
    patient_attributes = patients.copy()

    age_column = next(
        (c for c in ["age", "patient_age"] if c in patients.columns),
        None,
    )

    if age_column:
        ages = pd.to_numeric(patients[age_column], errors="coerce")
    else:
        dob_column = next(
            (
                c for c in ["date_of_birth", "dob", "birth_date"]
                if c in patients.columns
            ),
            None,
        )
        if dob_column:
            dob = pd.to_datetime(
                patients[dob_column], errors="coerce"
            )
            today = pd.Timestamp.today().normalize()
            ages = (
                today.year - dob.dt.year
                - (
                    (today.month < dob.dt.month)
                    | (
                        (today.month == dob.dt.month)
                        & (today.day < dob.dt.day)
                    )
                ).astype("Int64")
            )
            ages = pd.to_numeric(ages, errors="coerce")
        else:
            ages = pd.Series(
                float("nan"), index=patients.index, dtype="float64"
            )

    def age_band(value):
        if pd.isna(value) or value < 0 or value > 120:
            return "Unknown age"
        if value < 18:
            return "Under 18"
        if value < 30:
            return "18–29"
        if value < 45:
            return "30–44"
        if value < 60:
            return "45–59"
        return "60+"

    patient_attributes["_age_group"] = ages.map(age_band)

    gender_column = next(
        (c for c in ["gender", "sex"] if c in patients.columns),
        None,
    )

    if gender_column:
        patient_attributes["_gender"] = (
            patient_attributes[gender_column]
            .fillna("Unknown")
            .astype(str)
            .str.strip()
            .replace("", "Unknown")
        )
    else:
        patient_attributes["_gender"] = "Unknown"

    # Apply age and gender filters to patients before joining appointments.
    if age_group:
        patient_attributes = patient_attributes[
            patient_attributes["_age_group"].str.casefold()
            == age_group.strip().casefold()
        ]

    if gender:
        patient_attributes = patient_attributes[
            patient_attributes["_gender"].str.casefold()
            == gender.strip().casefold()
        ]

    allowed_patient_keys = set(
        patient_attributes["_patient_key"].dropna()
    )

    appointments = appointments[
        appointments["_patient_key"].isin(allowed_patient_keys)
    ].copy()

    # Build grouping labels.
    if group_by == "age":
        patient_groups = patient_attributes[
            ["_patient_key", "_age_group"]
        ].rename(columns={"_age_group": "group"})

    elif group_by == "gender":
        patient_groups = patient_attributes[
            ["_patient_key", "_gender"]
        ].rename(columns={"_gender": "group"})

    elif group_by == "disease":
        records = data.get("medical_records", pd.DataFrame()).copy()

        if "patient_id" not in records.columns:
            return unavailable(
                "Medical records must contain patient_id."
            )

        diagnosis_column = next(
            (
                c for c in [
                    "diagnosis", "condition", "disease",
                    "diagnosis_name", "primary_diagnosis",
                    "medical_condition",
                ]
                if c in records.columns
            ),
            None,
        )

        if not diagnosis_column:
            return unavailable(
                "No diagnosis or condition column exists in medical_records."
            )

        records["_patient_key"] = (
            records["patient_id"].astype("string").str.strip()
        )
        records["_condition"] = (
            records[diagnosis_column]
            .fillna("").astype(str).str.strip()
        )

        records = records[
            records["_patient_key"].isin(allowed_patient_keys)
            & records["_condition"].ne("")
        ]

        patient_groups = (
            records[["_patient_key", "_condition"]]
            .drop_duplicates()
            .rename(columns={"_condition": "group"})
        )

        diagnosed_keys = set(patient_groups["_patient_key"])
        undiagnosed = patient_attributes[
            ~patient_attributes["_patient_key"].isin(diagnosed_keys)
        ][["_patient_key"]].copy()
        undiagnosed["group"] = "No recorded diagnosis"

        patient_groups = pd.concat(
            [patient_groups, undiagnosed],
            ignore_index=True,
        )

    
    else:
        # Department grouping: appointments -> doctors -> staff -> departments.
        required_tables = {
            "doctors": {"id", "staff_id"},
            "staff": {"id", "department_id"},
            "departments": {"id", "name"},
        }

        for table, columns in required_tables.items():
            if table not in data or not columns.issubset(data[table].columns):
                return unavailable(
                    f"Required columns are unavailable in {table}."
                )

        if "doctor_id" not in appointments.columns:
            return unavailable(
                "Appointments must contain doctor_id for department grouping."
            )

        # Create normalized join keys without carrying duplicate ID columns.
        appointment_department_rows = appointments.copy()
        doctors = data["doctors"][["id", "staff_id"]].copy()
        staff = data["staff"][["id", "department_id"]].copy()
        departments = data["departments"][["id", "name"]].copy()

        appointment_department_rows["_doctor_key"] = (
            appointment_department_rows["doctor_id"]
            .astype("string").str.strip()
        )
        doctors["_doctor_key"] = doctors["id"].astype("string").str.strip()
        doctors["_staff_key"] = doctors["staff_id"].astype("string").str.strip()

        staff["_staff_key"] = staff["id"].astype("string").str.strip()
        staff["_department_key"] = (
            staff["department_id"].astype("string").str.strip()
        )

        departments["_department_key"] = (
            departments["id"].astype("string").str.strip()
        )
        departments["_department_name"] = (
            departments["name"].fillna("Unknown department")
            .astype(str).str.strip()
            .replace("", "Unknown department")
        )

        doctor_lookup = doctors[["_doctor_key", "_staff_key"]]
        staff_lookup = staff[["_staff_key", "_department_key"]]
        department_lookup = departments[
            ["_department_key", "_department_name"]
        ].rename(columns={"_department_name": "group"})

        joined = appointment_department_rows.merge(
            doctor_lookup, on="_doctor_key", how="left"
        )
        joined = joined.merge(
            staff_lookup, on="_staff_key", how="left"
        )
        joined = joined.merge(
            department_lookup, on="_department_key", how="left"
        )

        joined["group"] = (
            joined["group"].fillna("Unknown department")
            .astype(str).str.strip()
            .replace("", "Unknown department")
        )

        # Apply the selected department filter.
        if department and department.strip():
            joined = joined[
                joined["group"].str.casefold()
                == department.strip().casefold()
            ]

        # Apply patient age and gender filters too.
        allowed_patient_keys = set(
            patient_attributes["_patient_key"].dropna()
        )
        joined = joined[
            joined["_patient_key"].isin(allowed_patient_keys)
        ]

        result = _summarize_attendance_groups(joined, group_by)
        result["filters"] = {
            "start_date": start_date,
            "end_date": end_date,
            "department": department,
            "age_group": age_group,
            "gender": gender,
        }
        return result

    # Join filtered appointments to patient grouping labels.
    joined = appointments.merge(
        patient_groups,
        on="_patient_key",
        how="left",
    )

    joined["group"] = (
        joined["group"].fillna("Unknown")
        .astype(str).str.strip()
        .replace("", "Unknown")
    )

    joined["_status"] = _normalize_status(joined["status"])

    # Department filter can also restrict age, gender, and disease views.
    if department:
        required_tables = {
            "doctors": {"id", "staff_id"},
            "staff": {"id", "department_id"},
            "departments": {"id", "name"},
        }

        for table, columns in required_tables.items():
            if table not in data or not columns.issubset(data[table].columns):
                return unavailable(
                    f"Required columns are unavailable in {table}."
                )

        if "doctor_id" not in joined.columns:
            return unavailable(
                "Appointments must contain doctor_id for department filtering."
            )

        doctors = data["doctors"][["id", "staff_id"]].rename(
            columns={"id": "doctor_id"}
        )
        staff = data["staff"][["id", "department_id"]].rename(
            columns={"id": "staff_id"}
        )
        departments = data["departments"][["id", "name"]].rename(
            columns={"id": "department_id", "name": "department"}
        )

        for frame, column in [
            (joined, "doctor_id"),
            (doctors, "doctor_id"),
        ]:
            frame["_doctor_key"] = frame[column].astype("string").str.strip()

        joined = joined.merge(
            doctors[["_doctor_key", "staff_id"]],
            on="_doctor_key", how="left"
        )
        joined["_staff_key"] = joined["staff_id"].astype("string").str.strip()
        staff["_staff_key"] = staff["staff_id"].astype("string").str.strip()
        joined = joined.merge(
            staff[["_staff_key", "department_id"]],
            on="_staff_key", how="left"
        )
        joined["_department_key"] = (
            joined["department_id"].astype("string").str.strip()
        )
        departments["_department_key"] = (
            departments["department_id"].astype("string").str.strip()
        )
        joined = joined.merge(
            departments[["_department_key", "department"]],
            on="_department_key", how="left"
        )

        joined = joined[
            joined["department"].fillna("").str.casefold()
            == department.strip().casefold()
        ]

    result = _summarize_attendance_groups(joined, group_by)
    result["filters"] = {
        "start_date": start_date,
        "end_date": end_date,
        "department": department,
        "age_group": age_group,
        "gender": gender,
    }
    return result


def _summarize_attendance_groups(joined, group_by):
    """Calculate transparent appointment counts and attendance rates."""
    groups = []

    for label, frame in joined.groupby("group", dropna=False):
        statuses = _normalize_status(frame["status"])
        completed = int((statuses == "completed").sum())
        no_shows = int((statuses == "no_show").sum())
        eligible = completed + no_shows

        groups.append({
            "group": str(label),
            "total_appointment_records": int(len(frame)),
            "completed_appointments": completed,
            "recorded_no_shows": no_shows,
            "eligible_appointments": eligible,
            "attendance_rate_percent": round(
                completed / eligible * 100, 2
            ) if eligible else None,
            "no_show_rate_percent": round(
                no_shows / eligible * 100, 2
            ) if eligible else None,
            "attendance_denominator": eligible,
        })

    groups.sort(
        key=lambda row: (
            row["attendance_rate_percent"] is None,
            -(row["attendance_rate_percent"] or 0),
        )
    )

    return {
        "available": True,
        "group_by": group_by,
        "groups": groups,
        "metric_definitions": {
            "attendance_rate_percent": (
                "Completed / (completed + recorded no-shows) * 100"
            ),
            "no_show_rate_percent": (
                "Recorded no-shows / (completed + recorded no-shows) * 100"
            ),
        },
        "note": (
            "Scheduled, pending, cancelled, and other statuses are excluded "
            "from the attendance denominator. Disease groups may overlap "
            "when a patient has multiple recorded conditions. These are "
            "descriptive associations, not evidence that age, gender, or "
            "disease caused missed appointments."
        ),
    }

def build_attendance_trends(data, period="month"):
    import pandas as pd

    if period not in {"month", "year"}:
        raise ValueError("period must be 'month' or 'year'")

    appointments = data.get("appointments")

    if appointments is None or appointments.empty:
        return {
            "available": False,
            "period": period,
            "points": [],
            "note": "No appointment data is available.",
        }

    required = {"appointment_date", "status"}
    if not required.issubset(appointments.columns):
        return {
            "available": False,
            "period": period,
            "points": [],
            "note": "Appointment date or status column is missing.",
        }

    df = appointments[["appointment_date", "status"]].copy()
    df["date"] = pd.to_datetime(
        df["appointment_date"], errors="coerce"
    )
    df["status_clean"] = (
        df["status"].astype("string").str.strip().str.lower()
    )

    # Invalid dates cannot be assigned to a time period.
    df = df.dropna(subset=["date"])

    if df.empty:
        return {
            "available": False,
            "period": period,
            "points": [],
            "note": "No valid appointment dates were found.",
        }

    if period == "month":
        df["period"] = df["date"].dt.to_period("M").astype(str)
    else:
        df["period"] = df["date"].dt.year.astype(str)

    completed_statuses = {"completed", "complete"}
    no_show_statuses = {"no_show", "no-show", "no show", "noshow"}

    df["completed"] = df["status_clean"].isin(completed_statuses)
    df["no_show"] = df["status_clean"].isin(no_show_statuses)

    points = []

    for period_name, group in df.groupby("period", sort=True):
        completed = int(group["completed"].sum())
        no_shows = int(group["no_show"].sum())
        eligible = completed + no_shows

        points.append({
            "period": str(period_name),
            "appointment_records": int(len(group)),
            "completed_appointments": completed,
            "recorded_no_shows": no_shows,
            "eligible_appointments": eligible,
            "attendance_rate_percent": (
                round(completed / eligible * 100, 2)
                if eligible else None
            ),
            "no_show_rate_percent": (
                round(no_shows / eligible * 100, 2)
                if eligible else None
            ),
        })

    return {
        "available": True,
        "period": period,
        "points": points,
        "metric_definitions": {
            "attendance_rate_percent":
                "Completed / (completed + recorded no-shows) * 100",
            "no_show_rate_percent":
                "Recorded no-shows / (completed + recorded no-shows) * 100",
        },
        "note": (
            "Scheduled, pending, cancelled, and other statuses are "
            "excluded from the attendance denominator. Invalid dates "
            "are excluded from time-based trends."
        ),
    }
