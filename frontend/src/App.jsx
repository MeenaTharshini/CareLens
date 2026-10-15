
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  HeartPulse,
  LayoutDashboard,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Patient360 from "./Patient360";

import {
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import "./App.css";

const API = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const CHART_COLORS = [
  "#4776e6",
  "#22a699",
  "#f2a541",
  "#e76f8a",
  "#8765d8",
  "#6b91a8",
];

const STATUS_COLORS = {
  completed: "#20a486",
  complete: "#20a486",
  scheduled: "#4776e6",
  confirmed: "#4776e6",
  pending: "#f2a541",
  cancelled: "#e76f8a",
  canceled: "#e76f8a",
  "no-show": "#e76f8a",
  no_show: "#e76f8a",
  noshow: "#e76f8a",
  "in progress": "#4776e6",
  resolved: "#20a486",
  "needs verification": "#8765d8",
};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `${response.status}: ${message || response.statusText}`
    );
  }

  return response.json();
}

function firstValue(object, keys, fallback = null) {
  for (const key of keys) {
    const value = object?.[key];

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return fallback;
}

function asNumber(value) {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[%,$\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatNumber(value) {
  const number = asNumber(value);
  return number === null ? "—" : number.toLocaleString();
}

function formatPercent(value) {
  const number = asNumber(value);
  return number === null ? "—" : `${number.toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) return "Not recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function titleCase(value) {
  return String(value || "Unknown")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeGap(gap, index) {
  return {
    ...gap,
    id: firstValue(gap, ["gap_id", "care_gap_id", "id"], index),
    patientId: firstValue(gap, ["patient_id", "patientId"]),
    patientName: firstValue(
      gap,
      ["patient_name", "patientName", "name"],
      "Patient name unavailable"
    ),
    category: titleCase(
      firstValue(
        gap,
        ["gap_type", "gap_category", "category", "type"],
        "Other"
      )
    ),
    description: firstValue(
      gap,
      ["description", "reason", "details"],
      "Review the underlying record."
    ),
    priority: titleCase(
      firstValue(gap, ["priority", "severity"], "Unspecified")
    ),
    status: titleCase(
      firstValue(gap, ["status"], "Pending")
    ),
  };
}

function getFiles(summary) {
  return summary?.files || summary?.tables || {};
}

function getMetric(metrics, keys) {
  return asNumber(firstValue(metrics, keys));
}

function getTableRows(validation) {
  return (
    validation?.report ||
    validation?.tables ||
    validation?.table_reports ||
    {}
  );
}

function MetricCard({ icon: Icon, label, value, description, tone = "blue" }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-card-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon">
          <Icon size={19} />
        </span>
      </div>

      <div className="metric-value">{value}</div>
      <p className="metric-description">{description}</p>
    </article>
  );
}

function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="empty-state">
      <Database size={25} />
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  if (!message) return null;

  return (
    <div className="error-banner" role="alert">
      <AlertTriangle size={19} />
      <span>{message}</span>
      {onRetry && (
        <button className="button button-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip">
      <strong>{label || payload[0]?.name || "Details"}</strong>

      {payload.map((item, index) => (
        <div className="tooltip-row" key={`${item.dataKey}-${index}`}>
          <span
            className="tooltip-dot"
            style={{ background: item.color || item.fill || "#4776e6" }}
          />
          <span>{item.name || item.dataKey}</span>
          <b>
            {typeof item.value === "number"
              ? item.value.toLocaleString()
              : item.value}
            {item.unit || ""}
          </b>
        </div>
      ))}
    </div>
  );
}

function QualityDashboard({
  metrics,
  summary,
  validation,
  relationships,
  gaps,
  loading,
  onRefresh,
}) {
  const files = getFiles(summary);
  const validationTables = getTableRows(validation);

  const patients = getMetric(metrics, [
    "total_patients",
    "patient_count",
  ]) ?? asNumber(files?.patients?.rows);

  const appointments = getMetric(metrics, [
    "total_appointments",
    "appointment_count",
    "all_appointment_records",
  ]) ?? asNumber(files?.appointments?.rows);

  const completion = getMetric(metrics, [
    "appointment_completion_rate_percent",
    "appointment_completion_rate",
    "completion_rate",
    "appointment_completion_pct",
  ]);

  const noShow = getMetric(metrics, [
    "appointment_no_show_rate_percent",
    "appointment_no_show_rate",
    "no_show_rate",
    "no_show_pct",
  ]);

  const labAvailability = getMetric(metrics, [
    "lab_result_availability_percent",
    "lab_result_availability",
    "lab_result_availability_rate",
    "lab_result_rate",
  ]);

  const turnaround = getMetric(metrics, [
    "median_lab_turnaround_days",
    "median_turnaround_days",
    "median_lab_turnaround",
  ]);

  const completeness = getMetric(metrics, [
    "data_completeness_percent",
    "data_completeness",
  ]);

  const missingCells =
    getMetric(metrics, ["total_missing_cells", "missing_cells"]) ??
    Object.values(validationTables).reduce(
      (total, table) => total + (asNumber(table?.missing_cells) || 0),
      0
    );

  const statusDistribution = useMemo(() => {
    const source = firstValue(metrics, [
      "appointment_status_distribution",
      "appointment_status_counts",
      "appointment_distribution",
      "appointment_statuses",
    ]);

    if (Array.isArray(source)) {
      return source.map((item) => ({
        name: titleCase(
          firstValue(item, ["status", "name", "label"], "Unknown")
        ),
        value: asNumber(
          firstValue(item, ["count", "total", "value", "appointments"], 0)
        ) || 0,
      }));
    }

    if (source && typeof source === "object") {
      return Object.entries(source).map(([name, value]) => ({
        name: titleCase(name),
        value: asNumber(
          typeof value === "object"
            ? firstValue(value, ["count", "total", "value"], 0)
            : value
        ) || 0,
      }));
    }

    return [];
  }, [metrics]);

  const gapCategories = useMemo(() => {
    const counts = {};

    gaps.forEach((gap) => {
      counts[gap.category] = (counts[gap.category] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [gaps]);

  const gapStatuses = useMemo(() => {
    const counts = {};

    gaps.forEach((gap) => {
      counts[gap.status] = (counts[gap.status] || 0) + 1;
    });

    return Object.entries(counts).map(([name, value]) => ({
      name,
      value,
    }));
  }, [gaps]);

  const tableQuality = useMemo(() => {
    return Object.entries(validationTables)
      .map(([tableName, details]) => ({
        name: titleCase(tableName),
        missing: asNumber(details?.missing_cells) || 0,
        rows: asNumber(details?.total_rows) || 0,
        duplicates: asNumber(details?.duplicate_rows) || 0,
      }))
      .sort((a, b) => b.missing - a.missing)
      .slice(0, 8);
  }, [validationTables]);

  const totalGaps = gaps.length;
  const unresolvedGaps = gaps.filter(
    (gap) => !["resolved", "closed"].includes(gap.status.toLowerCase())
  ).length;

  const highPriorityGaps = gaps.filter((gap) =>
    ["high", "critical", "urgent"].includes(gap.priority.toLowerCase())
  ).length;

  const dataWarnings = [];

  if (missingCells > 0) {
    dataWarnings.push({
      title: `${formatNumber(missingCells)} missing cells`,
      description:
        "Some source fields are blank. Check whether they affect reporting before drawing conclusions.",
      tone: "warning",
    });
  }

  if (unresolvedGaps > 0) {
    dataWarnings.push({
      title: `${unresolvedGaps} care gaps need attention`,
      description:
        "Review the worklist, assign an owner, and document the verification outcome.",
      tone: "blue",
    });
  }

  if (highPriorityGaps > 0) {
    dataWarnings.push({
      title: `${highPriorityGaps} high-priority gaps`,
      description:
        "Confirm the source records and prioritize review using your care team's protocol.",
      tone: "danger",
    });
  }

  return (
    <div className="workspace-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">HOSPITAL PERFORMANCE</span>
          <h1>Quality Intelligence</h1>
          <p>
            Understand care delivery, identify data blind spots, and focus
            review effort where it is most needed.
          </p>
        </div>

        <button className="button button-secondary" onClick={onRefresh}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          Refresh data
        </button>
      </div>

      <div className="metric-grid">
        <MetricCard
          icon={Users}
          label="Registered patients"
          value={formatNumber(patients)}
          description="Patients represented in the source database"
          tone="blue"
        />
        <MetricCard
          icon={CalendarDays}
          label="Appointment records"
          value={formatNumber(appointments)}
          description="Recorded appointments in the available dataset"
          tone="purple"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Completion rate"
          value={formatPercent(completion)}
          description="Reported appointment completion metric"
          tone="green"
        />
        <MetricCard
          icon={Activity}
          label="No-show rate"
          value={formatPercent(noShow)}
          description="Reported missed-appointment metric"
          tone="orange"
        />
        <MetricCard
          icon={HeartPulse}
          label="Lab result availability"
          value={formatPercent(labAvailability)}
          description="Lab requests linked to available results"
          tone="teal"
        />
        <MetricCard
          icon={Clock3}
          label="Median lab turnaround"
          value={turnaround === null ? "—" : `${turnaround.toFixed(2)} days`}
          description="Median time reported by the backend"
          tone="purple"
        />
      </div>

      <div className="insight-strip">
        <div className="insight-symbol">
          <ShieldCheck size={22} />
        </div>
        <div className="insight-copy">
          <strong>Data reliability matters as much as performance</strong>
          <p>
            {completeness !== null
              ? `The backend reports ${completeness.toFixed(1)}% data completeness.`
              : "Data completeness has not been reported by the API."}{" "}
            Treat these as operational indicators, not proof of clinical
            outcomes.
          </p>
        </div>
        <div className="insight-stat">
          <span>Care-gap candidates</span>
          <strong>{formatNumber(totalGaps)}</strong>
        </div>
      </div>

      <div className="chart-grid">
        <Panel
          title="Appointment status"
          subtitle="Distribution of recorded appointment statuses"
        >
          {statusDistribution.length ? (
            <div className="chart-area chart-donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="48%"
                    innerRadius={65}
                    outerRadius={100}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {statusDistribution.map((item, index) => (
                      <Cell
                        key={item.name}
                        fill={
                          STATUS_COLORS[item.name.toLowerCase()] ||
                          CHART_COLORS[index % CHART_COLORS.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="Status breakdown unavailable"
              message="The metrics endpoint has not returned an appointment status distribution. The chart will appear when that data is exposed."
            />
          )}
        </Panel>

        <Panel
          title="Care-gap categories"
          subtitle="Which types of candidate gaps appear most often?"
        >
          {gapCategories.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={gapCategories}
                  layout="vertical"
                  margin={{ top: 8, right: 20, left: 10, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                  />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={125}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="value"
                    name="Candidate gaps"
                    fill="#4776e6"
                    radius={[0, 7, 7, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No care-gap categories"
              message="No candidate gaps were returned by the API."
            />
          )}
        </Panel>

        <Panel
          title="Care-gap review status"
          subtitle="Progress through the operational review workflow"
        >
          {gapStatuses.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={gapStatuses}
                  margin={{ top: 10, right: 12, left: -15, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10 }}
                    interval={0}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="value"
                    name="Care gaps"
                    radius={[7, 7, 0, 0]}
                    maxBarSize={48}
                  >
                    {gapStatuses.map((item, index) => (
                      <Cell
                        key={item.name}
                        fill={
                          STATUS_COLORS[item.name.toLowerCase()] ||
                          CHART_COLORS[index % CHART_COLORS.length]
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No review-status data"
              message="Review status counts will appear when care gaps are available."
            />
          )}
        </Panel>

        <Panel
          title="Data quality by table"
          subtitle="Tables with the largest number of missing values"
        >
          {tableQuality.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={tableQuality}
                  layout="vertical"
                  margin={{ top: 8, right: 22, left: 8, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                  />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={112}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    formatter={(value, name, item) => [
                      value,
                      name === "missing"
                        ? "Missing cells"
                        : name === "duplicates"
                          ? "Duplicate rows"
                          : name,
                    ]}
                  />
                  <Legend />
                  <Bar
                    dataKey="missing"
                    name="Missing cells"
                    fill="#e8a23d"
                    radius={[0, 6, 6, 0]}
                  />
                  <Bar
                    dataKey="duplicates"
                    name="Duplicate rows"
                    fill="#e76f8a"
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="Table quality breakdown unavailable"
              message="The validation API did not return table-level missing-cell or duplicate counts."
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Recommended review priorities"
        subtitle="Data-led operational prompts, not automated clinical diagnoses"
      >
        {dataWarnings.length ? (
          <div className="warning-list">
            {dataWarnings.map((warning) => (
              <div
                className={`warning-item warning-${warning.tone}`}
                key={warning.title}
              >
                <AlertTriangle size={19} />
                <div>
                  <strong>{warning.title}</strong>
                  <p>{warning.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No review prompts generated"
            message="No outstanding prompts were detected from the currently available summary."
          />
        )}
      </Panel>

      <Panel
        title="Dataset inventory"
        subtitle="Source tables available to the analytics platform"
      >
        {Object.keys(files).length ? (
          <div className="inventory-grid">
            {Object.entries(files).map(([name, table]) => (
              <div className="inventory-card" key={name}>
                <span>{titleCase(name)}</span>
                <strong>{formatNumber(table?.rows)}</strong>
                <small>
                  rows · {formatNumber(table?.columns)} columns
                </small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Dataset inventory unavailable"
            message="The summary endpoint did not return a files or tables collection."
          />
        )}
      </Panel>

      <p className="footnote">
        Metrics are based on the current backend response. Historical
        records, incomplete documentation, and missing clinical outcome
        fields can limit interpretation. A care-gap candidate requires
        verification before being treated as a confirmed care gap.
      </p>
    </div>
  );
}

function PatientWorkspace() {
  return <Patient360 />;
}

function DataTable({ columns, rows }) {
  if (!rows?.length) {
    return (
      <EmptyState
        title="No records returned"
        message="The backend returned no rows for this section."
      />
    );
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(([label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.request_id ?? index}>
              {columns.map(([label, getter]) => (
                <td key={label} title={String(getter(row) ?? "")}>
                  {String(getter(row) ?? "Not recorded")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [activeView, setActiveView] = useState("quality");
  const [metrics, setMetrics] = useState({});
  const [summary, setSummary] = useState({});
  const [validation, setValidation] = useState({});
  const [relationships, setRelationships] = useState({});
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const results = await Promise.allSettled([
        request("/api/metrics"),
        request("/api/data/summary"),
        request("/api/data/validation"),
        request("/api/data/relationships"),
        request("/api/care-gaps"),
      ]);

      const [metricResult, summaryResult, validationResult,
        relationshipsResult, gapsResult] = results;

      const failures = [];

      if (metricResult.status === "fulfilled") {
        setMetrics(metricResult.value?.metrics ?? metricResult.value ?? {});
      } else {
        failures.push(`Metrics: ${metricResult.reason.message}`);
      }

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
      } else {
        failures.push(`Data summary: ${summaryResult.reason.message}`);
      }

      if (validationResult.status === "fulfilled") {
        setValidation(validationResult.value);
      } else {
        failures.push(`Validation: ${validationResult.reason.message}`);
      }

      if (relationshipsResult.status === "fulfilled") {
        setRelationships(relationshipsResult.value);
      } else {
        failures.push(`Relationships: ${relationshipsResult.reason.message}`);
      }

      if (gapsResult.status === "fulfilled") {
        const rawGaps = Array.isArray(gapsResult.value)
          ? gapsResult.value
          : gapsResult.value?.care_gaps ??
            gapsResult.value?.gaps ??
            gapsResult.value?.items ??
            [];

        setGaps(rawGaps.map(normalizeGap));
      } else {
        failures.push(`Care gaps: ${gapsResult.reason.message}`);
      }

      if (failures.length === results.length) {
        setError(
          "Unable to connect to the CareLens API. Confirm that FastAPI is running at " +
          API
        );
      } else if (failures.length) {
        setError(
          `Some dashboard sections could not load: ${failures.join(" | ")}`
        );
      }
    } catch (loadError) {
      setError(loadError.message || "Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <HeartPulse size={24} />
          </div>
          <div>
            <strong>CareLens</strong>
            <span>Value-Based Care Analytics</span>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACES</div>

        <button
          className={`nav-item ${activeView === "quality" ? "active" : ""}`}
          onClick={() => setActiveView("quality")}
        >
          <LayoutDashboard size={19} />
          <span>Quality intelligence</span>
        </button>

        <button
          className={`nav-item ${activeView === "patient" ? "active" : ""}`}
          onClick={() => setActiveView("patient")}
        >
          <Users size={19} />
          <span>Patient 360</span>
        </button>

        <div className="sidebar-bottom">
          <div className="system-status">
            <span className="status-indicator" />
            <div>
              <strong>Analytics workspace</strong>
              <small>API-backed insights</small>
            </div>
          </div>
          <p>CareLens · Value-based care</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            CareLens <span>/</span>{" "}
            {activeView === "quality"
              ? "Quality intelligence"
              : "Patient 360"}
          </div>

          <div className="topbar-actions">
            <span className="live-label">
              <span className="status-indicator" />
              Live API data
            </span>
            <button
              className="icon-button"
              onClick={loadDashboard}
              aria-label="Refresh dashboard"
              title="Refresh dashboard data"
            >
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>

        <ErrorBanner message={error} onRetry={loadDashboard} />

        {activeView === "quality" ? (
  <QualityDashboard
    metrics={metrics}
    summary={summary}
    validation={validation}
    relationships={relationships}
    gaps={gaps}
    loading={loading}
    onRefresh={loadDashboard}
  />
) : (
  <PatientWorkspace />
)}

        <footer className="app-footer">
          <span>CareLens Analytics</span>
          <span>Insights support review; clinical decisions remain with care teams.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
