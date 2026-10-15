# CareLens — Measure Specification

## 1. Appointment Completion Rate

- **Purpose:** Measure the proportion of recorded appointments marked completed.
- **Numerator:** Number of appointments with status `completed`.
- **Denominator:** Total number of appointment records.
- **Formula:** `(Completed appointments / All appointment records) × 100`
- **Current result:** 84.6% (846 / 1,000).
- **Interpretation:** Describes recorded appointment completion, not overall clinical quality.
- **Limitation:** Appointment records may include historical or incomplete information.

## 2. Recorded No-Show Rate

- **Purpose:** Measure the proportion of completed or no-show appointments recorded as no-shows.
- **Numerator:** Number of appointments marked `no_show`.
- **Denominator:** Completed appointments + no-show appointments.
- **Formula:** `(Recorded no-shows / Eligible appointment records) × 100`
- **Current result:** 4.73% (42 / 888).
- **Interpretation:** Describes the no-show rate among records with these two statuses.
- **Limitation:** Other statuses are excluded from the denominator. This is not a measure of all missed clinical care.

## 3. Lab Result Availability

- **Purpose:** Measure how many lab requests have at least one linked lab result.
- **Numerator:** Lab requests with at least one linked result.
- **Denominator:** All lab requests.
- **Formula:** `(Requests with linked results / All lab requests) × 100`
- **Current result:** 91.67% (110 / 120).
- **Interpretation:** Measures result linkage in the available dataset.
- **Limitation:** A linked record does not establish that a result was reviewed, communicated, or acted upon.

## 4. Median Lab Turnaround Time

- **Purpose:** Describe the median elapsed time between a lab request and a recorded result performance date.
- **Calculation:** Median of valid, non-negative elapsed-day values.
- **Current result:** 1.25 days across 110 valid date pairs.
- **Interpretation:** Summarizes the observed turnaround in the available records.
- **Limitation:** Performance date may not represent final report availability or clinician review time. Invalid and negative intervals must be excluded and reported transparently.

## 5. Data Completeness

- **Purpose:** Describe the proportion of populated cells across the six loaded tables.
- **Formula:** `(Populated cells / Total cells) × 100`
- **Current result:** 96.95%, with 291 missing cells.
- **Interpretation:** Summarizes structural completeness of the loaded data.
- **Limitation:** Missing optional fields, such as appointment notes, may not represent a data-quality failure. Completeness does not measure accuracy.

## 6. Candidate Care-Gap Worklist

- **Purpose:** Identify records that may warrant human review.
- **Current rules:**
  1. Appointments recorded as `no_show`.
  2. Lab requests without a linked result.
- **Current result:** 52 flagged records (42 no-show appointments and 10 requests without linked results).
- **Interpretation:** These are review candidates, not confirmed clinical care gaps.
- **Limitation:** Historical records must not automatically be treated as overdue. Missing linkage does not prove that care was missed.

## Dataset and Governance Notes

- The current dataset contains synthetic/sample records and is intended for demonstration and testing.
- Metric values describe the loaded dataset only; they should not be presented as real-world clinical performance.
- Care-gap candidates require appropriate human review before any clinical conclusion or action.
- Each displayed rate should show its numerator and denominator where practical.
- Invalid dates, unknown statuses, duplicate identifiers, and unmatched relationships should be monitored as data-quality issues.