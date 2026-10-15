import pandas as pd

from engine import (
    validate_data,
    validate_relationships,
    calculate_metrics,
    build_care_gap_worklist,
)


def make_test_data():
    return {
        "patients": pd.DataFrame({
            "id": [1, 2],
        }),
        "appointments": pd.DataFrame({
            "id": [101, 102, 103, 104],
            "patient_id": [1, 2, 1, 2],
            "appointment_date": [
                "2025-01-01",
                "2025-01-02",
                "2025-01-03",
                "2025-01-04",
            ],
            "status": [
                "completed",
                "no_show",
                "cancelled",
                "completed",
            ],
            "notes": [None, "Follow-up", "Cancelled", "Routine"],
        }),
        "medical_records": pd.DataFrame({
            "id": [201, 202],
            "patient_id": [1, 2],
        }),
        "departments": pd.DataFrame({
            "id": [1],
            "name": ["General"],
        }),
        "lab_requests": pd.DataFrame({
            "id": [301, 302],
            "medical_record_id": [201, 202],
            "request_date": ["2025-01-01", "2025-01-02"],
        }),
        "lab_results": pd.DataFrame({
            "id": [401],
            "request_id": [301],
            "performed_date": ["2025-01-03"],
        }),
    }


def test_data_validation_reports_missing_notes():
    report = validate_data(make_test_data())

    assert report["appointments"]["missing_by_column"]["notes"] == 1
    assert report["appointments"]["duplicate_ids"] == 0


def test_relationships_pass_for_valid_data():
    report = validate_relationships(make_test_data())

    assert len(report) == 4
    assert all(item["status"] == "passed" for item in report)


def test_metrics_use_expected_denominators():
    metrics = calculate_metrics(make_test_data())

    assert metrics["appointment_completion_rate_percent"] == 50.0
    assert metrics["appointment_no_show_rate_percent"] == 33.33
    assert metrics["no_show_rate_denominator"] == 3
    assert metrics["lab_result_availability_percent"] == 50.0
    assert metrics["median_lab_turnaround_days"] == 2.0


def test_worklist_flags_no_show_and_missing_lab_result():
    worklist = build_care_gap_worklist(make_test_data())

    assert len(worklist) == 2
    assert set(worklist["rule_id"]) == {
        "APPOINTMENT_NO_SHOW",
        "LAB_RESULT_NOT_LINKED",
    }
    assert set(worklist["status"]) == {"Pending Review"}