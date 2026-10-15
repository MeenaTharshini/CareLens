
import pandas as pd

from engine import (
    validate_data,
    validate_relationships,
    calculate_metrics,
    build_care_gap_worklist,
)
from test_engine import make_test_data


def test_duplicate_appointment_ids_are_detected():
    data = make_test_data()

    # Create a duplicate appointment ID.
    data["appointments"].loc[1, "id"] = data["appointments"].loc[0, "id"]

    report = validate_data(data)

    assert report["appointments"]["duplicate_ids"] == 1


def test_missing_appointment_status_is_detected():
    data = make_test_data()

    data["appointments"].loc[0, "status"] = None

    report = validate_data(data)

    assert report["appointments"]["missing_statuses"] == 1


def test_unknown_appointment_status_is_detected():
    data = make_test_data()

    data["appointments"].loc[0, "status"] = "unknown_status"

    report = validate_data(data)

    assert "unknown_status" in report["appointments"]["unknown_statuses"]



def test_missing_patient_relationship_is_detected():
    data = make_test_data()

    # Convert the column to string before inserting a new ID.
    data["appointments"]["patient_id"] = (
        data["appointments"]["patient_id"].astype(str)
    )
    data["appointments"].loc[0, "patient_id"] = "PATIENT_NOT_FOUND"

    report = validate_relationships(data)

    # validate_relationships() returns a list of relationship reports.
    appointment_relationship = next(
        item for item in report
        if item["relationship"] == "appointments.patient_id -> patients.id"
    )

    assert appointment_relationship["unmatched_foreign_keys"] == 1


def test_empty_worklist_when_no_rules_are_triggered():
    data = make_test_data()

    # Remove no-show candidates.
    data["appointments"]["status"] = "completed"

    # Make every lab request have a linked result.
    request_ids = data["lab_requests"]["id"].tolist()

    if request_ids:
        data["lab_results"] = pd.DataFrame({
            "id": range(1, len(request_ids) + 1),
            "performed_date": ["2026-01-03"] * len(request_ids),
            "request_id": request_ids,
            "result_details": ["Test result"] * len(request_ids),
            "technician_id": [1] * len(request_ids),
        })

    worklist = build_care_gap_worklist(data)

    assert worklist.empty
    assert list(worklist.columns) == [
        "gap_id",
        "rule_id",
        "gap_type",
        "record_id",
        "patient_id",
        "event_date",
        "evidence",
        "status",
        "priority",
    ]


def test_invalid_lab_dates_do_not_crash_metrics():
    data = make_test_data()

    # Replace a lab date with an invalid value.
    data["lab_requests"]["request_date"] = (
        data["lab_requests"]["request_date"].astype(object)
    )
    data["lab_requests"].loc[0, "request_date"] = "not-a-date"

    # Metrics should handle invalid dates without crashing.
    metrics = calculate_metrics(data)

    assert isinstance(metrics, dict)
    assert "median_lab_turnaround_days" in metrics


def test_multiple_results_for_one_lab_request():
    data = make_test_data()

    # Duplicate an existing result, linking it to the same request.
    if not data["lab_results"].empty:
        duplicate = data["lab_results"].iloc[[0]].copy()
        duplicate["id"] = 9999

        data["lab_results"] = pd.concat(
            [data["lab_results"], duplicate],
            ignore_index=True,
        )

    metrics = calculate_metrics(data)

    assert isinstance(metrics, dict)
    assert "lab_result_availability_percent" in metrics


def test_multiple_results_do_not_count_one_request_twice_in_median():
    data = make_test_data()

    # Add a second result for the same request, with a later date.
    if not data["lab_results"].empty:
        duplicate = data["lab_results"].iloc[[0]].copy()
        duplicate["id"] = 9999
        duplicate["performed_date"] = "2030-01-01"

        data["lab_results"] = pd.concat(
            [data["lab_results"], duplicate],
            ignore_index=True,
        )

        metrics = calculate_metrics(data)

        # The turnaround observation count is per request,
        # not per result row.
        assert (
            metrics["valid_lab_turnaround_requests"]
            <= data["lab_requests"]["id"].nunique()
        )
