
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import "./AttendanceAnalytics.css";
const API =
  (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000")
    .replace(/\/$/, "");

const AGE_GROUPS = [
  "Under 18",
  "18–29",
  "30–44",
  "45–59",
  "60+",
  "Unknown age",
];

export default function AttendanceAnalytics() {
  const [groupBy, setGroupBy] = useState("age");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [department, setDepartment] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [gender, setGender] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadAttendance() {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ group_by: groupBy });

      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (department) params.set("department", department);
      if (ageGroup) params.set("age_group", ageGroup);
      if (gender) params.set("gender", gender);

      const response = await fetch(
        `${API}/api/analytics/attendance?${params.toString()}`
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not load attendance data.");
      }

      setData(result);
    } catch (err) {
      setError(err.message || "Could not connect to the API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAttendance();
  }, [groupBy]);

  function clearFilters() {
    setStartDate("");
    setEndDate("");
    setDepartment("");
    setAgeGroup("");
    setGender("");
    setGroupBy("age");
  }

  const groups = data?.groups || [];

  return (
    <section className="attendance-analytics">
      <div className="attendance-heading">
        <div>
          <h2>Attendance Analytics</h2>
          <p>
            Compare completed appointments and recorded no-shows.
          </p>
        </div>

        <button onClick={loadAttendance} disabled={loading}>
          {loading ? "Loading..." : "Apply filters"}
        </button>
      </div>

      <div className="attendance-filters">
        <label>
          Group results by
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            <option value="age">Age group</option>
            <option value="gender">Gender</option>
            <option value="department">Department</option>
            <option value="disease">Disease</option>
          </select>
        </label>

        <label>
          From date
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>

        <label>
          To date
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>

        <label>
          Department
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Department name"
          />
        </label>

        <label>
          Age group
          <select
            value={ageGroup}
            onChange={(e) => setAgeGroup(e.target.value)}
          >
            <option value="">All age groups</option>
            {AGE_GROUPS.map((age) => (
              <option key={age} value={age}>{age}</option>
            ))}
          </select>
        </label>

        <label>
          Gender
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          >
            <option value="">All genders</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Unknown">Unknown</option>
          </select>
        </label>

        <button
          className="attendance-clear"
          onClick={clearFilters}
          type="button"
        >
          Clear filters
        </button>
      </div>

      {error && <p role="alert" className="attendance-error">{error}</p>}

      {!error && data?.note && (
        <p className="attendance-note">{data.note}</p>
      )}

      <div className="attendance-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Appointment records</th>
              <th>Eligible appointments</th>
              <th>Completed</th>
              <th>Recorded no-shows</th>
              <th>Attendance rate</th>
              <th>No-show rate</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((row, index) => (
              <tr key={`${row.group}-${index}`}>
                <td>{row.group}</td>
                <td>{row.total_appointment_records ?? "—"}</td>
                <td>{row.eligible_appointments ?? row.attendance_denominator ?? "—"}</td>
                <td>{row.completed_appointments ?? "—"}</td>
                <td>{row.recorded_no_shows ?? "—"}</td>
                <td>
                  {row.attendance_rate_percent == null
                    ? "—"
                    : `${row.attendance_rate_percent}%`}
                </td>
                <td>
                  {row.no_show_rate_percent == null
                    ? "—"
                    : `${row.no_show_rate_percent}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {groups.length > 0 && (
        <div className="attendance-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={groups}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="group" />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Bar
                dataKey="attendance_rate_percent"
                name="Attendance rate"
                fill="#22a699"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <p>No attendance groups match the selected filters.</p>
      )}
    </section>
  );
}
