import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  HeartPulse,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Users,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Search,
  ChevronLeft,
  ChevronRight,
  X,BellRing,
Check,
CheckCheck,
CircleAlert,
ExternalLink,
Phone,
MapPin,
UserRound,
} from "lucide-react";
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
  LineChart,
  Line,
} from "recharts";
import Patient360 from "./Patient360";
import AttendanceAnalytics from "./AttendanceAnalytics";
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
  resolved: "#20a486",
  closed: "#20a486",
  "in progress": "#4776e6",
  "pending review": "#f2a541",
};

async function request(path) {
  const response = await fetch(`${API}${path}`);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status}: ${message || response.statusText}`);
  }

  return response.json();
}
async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status}: ${message || response.statusText}`);
  }

  return response.json();
}
function firstValue(object, keys, fallback = null) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function asNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

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
      firstValue(gap, ["gap_type", "gap_category", "category", "type"], "Other")
    ),
    description: firstValue(
      gap,
      ["description", "reason", "details"],
      "Review the underlying record."
    ),
    priority: titleCase(firstValue(gap, ["priority", "severity"], "Unspecified")),
    status: titleCase(firstValue(gap, ["status"], "Pending Review")),
  };
}

function getFiles(summary) {
  return summary?.files || summary?.tables || {};
}

function getMetric(metrics, keys) {
  return asNumber(firstValue(metrics, keys));
}

function getTableRows(validation) {
  return validation?.report || validation?.tables || validation?.table_reports || {};
}

function MetricCard({ icon: Icon, label, value, description, tone = "blue" }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-card-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon"><Icon size={19} /></span>
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
      <button className="button button-small" onClick={onRetry}>Retry</button>
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
          <tr>{columns.map(([label]) => <th key={label}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.request_id ?? row.department ?? index}>
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

function CareGapWorklist({ gaps }) {
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [expandedGap, setExpandedGap] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  const filteredGaps = useMemo(() => {
    const query = search.trim().toLowerCase();

    return [...gaps]
      .filter((gap) =>
        priorityFilter === "All" ||
        String(gap.priority).toLowerCase() === priorityFilter.toLowerCase()
      )
      .filter((gap) =>
        statusFilter === "All" ||
        String(gap.status).toLowerCase() === statusFilter.toLowerCase()
      )
      .filter((gap) => {
        if (!query) return true;
        return [
          gap.category,
          gap.patientName,
          gap.patientId,
          gap.record_id,
          gap.event_date,
          gap.status,
          gap.priority,
          gap.description,
          gap.rule_id,
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const order = { critical: 0, urgent: 0, high: 1, medium: 2, low: 3 };
        return (
          (order[String(a.priority).toLowerCase()] ?? 4) -
          (order[String(b.priority).toLowerCase()] ?? 4)
        );
      });
  }, [gaps, priorityFilter, statusFilter, search]);

  const highCount = gaps.filter((gap) =>
    ["high", "critical", "urgent"].includes(String(gap.priority).toLowerCase())
  ).length;

  const mediumCount = gaps.filter(
    (gap) => String(gap.priority).toLowerCase() === "medium"
  ).length;

  const pendingCount = gaps.filter(
    (gap) => !["resolved", "closed"].includes(String(gap.status).toLowerCase())
  ).length;

  const totalPages = Math.max(1, Math.ceil(filteredGaps.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const visibleGaps = filteredGaps.slice(startIndex, startIndex + pageSize);

  useEffect(() => {
    setPage(1);
    setExpandedGap(null);
  }, [priorityFilter, statusFilter, search, pageSize]);

  return (
    <Panel
      title="Smart Care Gap Prioritization"
      subtitle="Rule-based candidates for review by the care team"
      className="care-gap-worklist-panel"
    >
      <div className="gap-summary-grid">
        <div className="gap-summary-card">
          <span>Total candidates</span>
          <strong>{gaps.length}</strong>
        </div>
        <div className="gap-summary-card gap-summary-high">
          <span>High priority</span>
          <strong>{highCount}</strong>
        </div>
        <div className="gap-summary-card gap-summary-medium">
          <span>Medium priority</span>
          <strong>{mediumCount}</strong>
        </div>
        <div className="gap-summary-card">
          <span>Awaiting resolution</span>
          <strong>{pendingCount}</strong>
        </div>
      </div>

      <div className="gap-toolbar">
        <label className="gap-search">
          <Search size={17} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search patient, record, category..."
            aria-label="Search care gaps"
          />
          {search && (
            <button
              type="button"
              className="clear-search"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </label>

        <label className="filter-control">
          <span>Priority</span>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option>All</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
            <option>Critical</option>
          </select>
        </label>

        <label className="filter-control">
          <span>Review status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option>All</option>
            {[...new Set(gaps.map((gap) => gap.status))].sort().map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>

        <label className="filter-control page-size-control">
          <span>Show</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={6}>6</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </select>
        </label>
      </div>

      <div className="gap-list-heading">
        <span>
          Showing {filteredGaps.length ? startIndex + 1 : 0}–{Math.min(startIndex + pageSize, filteredGaps.length)} of {filteredGaps.length}
        </span>
        <span>Expand a row to view evidence and recommended action</span>
      </div>

      {!visibleGaps.length ? (
        <EmptyState
          title="No matching care gaps"
          message="Try changing the search text or filters."
        />
      ) : (
        <div className="care-gap-list">
          {visibleGaps.map((gap) => {
            const isExpanded = expandedGap === gap.id;
            const priorityClass = String(gap.priority).toLowerCase().replace(/\s+/g, "-");
            const statusClass = String(gap.status).toLowerCase().replace(/\s+/g, "-");

            return (
              <article className={`care-gap-item ${isExpanded ? "is-expanded" : ""}`} key={gap.id}>
                <button
                  type="button"
                  className="care-gap-item-header"
                  onClick={() => setExpandedGap(isExpanded ? null : gap.id)}
                  aria-expanded={isExpanded}
                >
                  <span className={`gap-type-icon priority-icon-${priorityClass}`}>
                    <ClipboardList size={18} />
                  </span>

                  <span className="care-gap-main">
                    <span className="care-gap-title-row">
                      <strong>{gap.category}</strong>
                      <span className={`gap-priority priority-${priorityClass}`}>
                        {gap.priority}
                      </span>
                    </span>

                    <span className="care-gap-person">
                      {gap.patientName}
                      <span>Patient ID: {gap.patientId ?? "Not linked"}</span>
                    </span>

                    <span className="care-gap-meta">
                      Record: {gap.record_id ?? "Not available"}
                      {" · "}
                      Date: {gap.event_date ?? "Not recorded"}
                    </span>
                  </span>

                  <span className={`gap-status status-${statusClass}`}>{gap.status}</span>
                  <span className="gap-expand-icon">
                    {isExpanded ? <ChevronUp size={19} /> : <ChevronDown size={19} />}
                  </span>
                </button>

                {isExpanded && (
                  <div className="care-gap-details">
                    <div className="gap-detail-block">
                      <span className="gap-detail-label">Evidence</span>
                      <p>{gap.evidence || gap.description || "Review the underlying source record."}</p>
                    </div>
                    <div className="gap-detail-block">
                      <span className="gap-detail-label">Why this priority?</span>
                      <p>{gap.priority_reason || "No priority explanation was returned by the API."}</p>
                    </div>
                    <div className="gap-detail-block">
                      <span className="gap-detail-label">Recommended review action</span>
                      <p>{gap.recommended_action || "Verify the source record and document the review outcome."}</p>
                    </div>
                    <div className="gap-detail-block">
                      <span className="gap-detail-label">Rule ID</span>
                      <p>{gap.rule_id || "Not provided"}</p>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {filteredGaps.length > 0 && (
        <div className="gap-pagination">
          <span>Page {safePage} of {totalPages}</span>
          <div className="pagination-actions">
            <button
              type="button"
              className="pagination-button"
              disabled={safePage <= 1}
              onClick={() => {
                setPage((current) => Math.max(1, current - 1));
                setExpandedGap(null);
              }}
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <button
              type="button"
              className="pagination-button"
              disabled={safePage >= totalPages}
              onClick={() => {
                setPage((current) => Math.min(totalPages, current + 1));
                setExpandedGap(null);
              }}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      <p className="analytics-note">
        Priority reflects predefined data-review rules, not a validated clinical risk score.
        Confirm each candidate against source records before taking action.
      </p>
    </Panel>
  );
}

function QualityDashboard({
  metrics,
  summary,
  validation,
  gaps,
  loading,
  onRefresh,
  population,
  trends,
  insights,
  trendPeriod,
  onPeriodChange,
}) {
  const files = getFiles(summary);
  const validationTables = getTableRows(validation);

  const patients = getMetric(metrics, ["total_patients", "patient_count"])
    ?? asNumber(files?.patients?.rows);

  const appointments = getMetric(metrics, [
    "total_appointments", "appointment_count", "all_appointment_records",
  ]) ?? asNumber(files?.appointments?.rows);

  const completion = getMetric(metrics, [
    "appointment_completion_rate_percent", "appointment_completion_rate",
    "completion_rate", "appointment_completion_pct",
  ]);

  const noShow = getMetric(metrics, [
    "appointment_no_show_rate_percent", "appointment_no_show_rate",
    "no_show_rate", "no_show_pct",
  ]);

  const labAvailability = getMetric(metrics, [
    "lab_result_availability_percent", "lab_result_availability",
    "lab_result_availability_rate", "lab_result_rate",
  ]);

  const turnaround = getMetric(metrics, [
    "median_lab_turnaround_days", "median_turnaround_days", "median_lab_turnaround",
  ]);

  const completeness = getMetric(metrics, ["data_completeness_percent", "data_completeness"]);

  const missingCells = getMetric(metrics, ["total_missing_cells", "missing_cells"])
    ?? Object.values(validationTables).reduce(
      (total, table) => total + (asNumber(table?.missing_cells) || 0), 0
    );

  const statusDistribution = useMemo(() => {
    const source = firstValue(metrics, [
      "appointment_status_distribution", "appointment_status_counts",
      "appointment_distribution", "appointment_statuses",
    ]);

    if (Array.isArray(source)) {
      return source.map((item) => ({
        name: titleCase(firstValue(item, ["status", "name", "label"], "Unknown")),
        value: asNumber(firstValue(item, ["count", "total", "value", "appointments"], 0)) || 0,
      }));
    }

    if (source && typeof source === "object") {
      return Object.entries(source).map(([name, value]) => ({
        name: titleCase(name),
        value: asNumber(
          typeof value === "object" ? firstValue(value, ["count", "total", "value"], 0) : value
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
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [gaps]);

  const tableQuality = useMemo(() => (
    Object.entries(validationTables)
      .map(([tableName, details]) => ({
        name: titleCase(tableName),
        missing: asNumber(details?.missing_cells) || 0,
        duplicates: asNumber(details?.duplicate_rows) || 0,
      }))
      .sort((a, b) => b.missing - a.missing)
      .slice(0, 8)
  ), [validationTables]);

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
      description: "Check whether missing source fields affect reporting before drawing conclusions.",
      tone: "warning",
    });
  }
  if (unresolvedGaps > 0) {
    dataWarnings.push({
      title: `${unresolvedGaps} care-gap candidates need review`,
      description: "Verify the source record, assign an owner, and document the review outcome.",
      tone: "blue",
    });
  }
  if (highPriorityGaps > 0) {
    dataWarnings.push({
      title: `${highPriorityGaps} high-priority candidates`,
      description: "Confirm source records and follow the care team's review protocol.",
      tone: "danger",
    });
  }

  const departments = population?.groups ?? [];

  const normalizedTrends = useMemo(() => {
    const appointmentPoints = trends?.trends?.appointments?.points ?? [];
    const labRequestPoints = trends?.trends?.lab_requests?.points ?? [];
    const periods = new Set([
      ...appointmentPoints.map((item) => item.period),
      ...labRequestPoints.map((item) => item.period),
    ]);

    const appointmentsByPeriod = new Map(
      appointmentPoints.map((item) => [item.period, asNumber(item.count) ?? 0])
    );
    const labsByPeriod = new Map(
      labRequestPoints.map((item) => [item.period, asNumber(item.count) ?? 0])
    );

    return [...periods].sort().map((period) => ({
      period,
      appointments: appointmentsByPeriod.get(period) ?? 0,
      labRequests: labsByPeriod.get(period) ?? 0,
    }));
  }, [trends]);

  const insightItems = useMemo(() => {
    if (Array.isArray(insights)) return insights;
    const candidates = [
      insights?.insights, insights?.items, insights?.observations,
      insights?.findings, insights?.alerts,
    ];
    return candidates.find(Array.isArray) ?? [];
  }, [insights]);

  return (
    <div className="workspace-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">HOSPITAL PERFORMANCE</span>
          <h1>Quality Intelligence</h1>
          <p>Understand care delivery, identify data blind spots, and focus review effort where it is most needed.</p>
        </div>
        <button className="button button-secondary" onClick={onRefresh}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          Refresh data
        </button>
      </div>

      <div className="metric-grid">
        <MetricCard icon={Users} label="Registered patients" value={formatNumber(patients)} description="Patients in the source database" tone="blue" />
        <MetricCard icon={CalendarDays} label="Appointment records" value={formatNumber(appointments)} description="Recorded appointments in the dataset" tone="purple" />
        <MetricCard icon={CheckCircle2} label="Completion rate" value={formatPercent(completion)} description="Reported appointment completion metric" tone="green" />
        <MetricCard icon={Activity} label="No-show rate" value={formatPercent(noShow)} description="Reported missed-appointment metric" tone="orange" />
        <MetricCard icon={HeartPulse} label="Lab result availability" value={formatPercent(labAvailability)} description="Lab requests linked to available results" tone="teal" />
        <MetricCard icon={Clock3} label="Median lab turnaround" value={turnaround === null ? "—" : `${turnaround.toFixed(2)} days`} description="Median turnaround reported by the backend" tone="purple" />
      </div>

      <div className="insight-strip">
        <div className="insight-symbol"><ShieldCheck size={22} /></div>
        <div className="insight-copy">
          <strong>Data reliability matters as much as performance</strong>
          <p>
            {completeness !== null
              ? `The backend reports ${completeness.toFixed(1)}% data completeness.`
              : "Data completeness has not been reported."}{" "}
            Treat operational indicators as signals for review, not proof of clinical outcomes.
          </p>
        </div>
        <div className="insight-stat">
          <span>Care-gap candidates</span>
          <strong>{formatNumber(gaps.length)}</strong>
        </div>
      </div>

      <CareGapWorklist gaps={gaps} />

      <div className="chart-grid">
        <Panel title="Appointment status" subtitle="Distribution of recorded statuses">
          {statusDistribution.length ? (
            <div className="chart-area chart-donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusDistribution} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={54} outerRadius={86} paddingAngle={3} stroke="none">
                    {statusDistribution.map((item, index) => (
                      <Cell key={item.name} fill={STATUS_COLORS[item.name.toLowerCase()] || CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Status breakdown unavailable" message="The metrics endpoint did not return an appointment status distribution." />
          )}
        </Panel>

        <Panel title="Care-gap categories" subtitle="Types of candidate gaps returned by the API">
          {gapCategories.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gapCategories} layout="vertical" margin={{ top: 8, right: 20, left: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" name="Candidate gaps" fill="#4776e6" radius={[0, 7, 7, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No care-gap categories" message="No candidate gaps were returned by the API." />
          )}
        </Panel>

        <Panel title="Care-gap review status" subtitle="Progress through the review workflow">
          {gapStatuses.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gapStatuses} margin={{ top: 10, right: 12, left: 0, bottom: 14 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" name="Care gaps" radius={[7, 7, 0, 0]} maxBarSize={48}>
                    {gapStatuses.map((item, index) => (
                      <Cell key={item.name} fill={STATUS_COLORS[item.name.toLowerCase()] || CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No review-status data" message="Review status counts will appear when care gaps are available." />
          )}
        </Panel>

        <Panel title="Data quality by table" subtitle="Tables with the most missing values">
          {tableQuality.length ? (
            <div className="chart-area chart-quality">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tableQuality} layout="vertical" margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend verticalAlign="bottom" />
                  <Bar dataKey="missing" name="Missing cells" fill="#e8a23d" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="duplicates" name="Duplicate rows" fill="#e76f8a" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Table quality unavailable" message="The validation endpoint did not return table-level quality counts." />
          )}
        </Panel>
      </div>

      <div className="section-heading">
        <span className="eyebrow">POPULATION & OPERATIONS</span>
        <h2>Department and trend analytics</h2>
        <p>Compare recorded operational activity with transparent denominators.</p>
      </div>

      <div className="chart-grid analytics-grid">
        <Panel title="Department completion rates" subtitle="Completed appointments divided by all appointments">
          {departments.length ? (
            <>
              <div className="analytics-summary">
                <span>{formatNumber(population?.total_appointments)} appointments</span>
                <span>{formatNumber(population?.departments_count)} departments</span>
              </div>
              <div className="chart-area">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departments} layout="vertical" margin={{ top: 8, right: 20, left: 10, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="department" width={125} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(2)}%`, "Completion rate"]} />
                    <Bar dataKey="completion_rate_percent" name="Completion rate" fill="#22a699" radius={[0, 6, 6, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <EmptyState title="Department analytics unavailable" message={population?.message || "The API did not return department groups."} />
          )}
        </Panel>

        <Panel title="Department no-show rates" subtitle="Recorded no-shows divided by completed appointments plus no-shows">
          {departments.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departments} layout="vertical" margin={{ top: 8, right: 20, left: 10, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="department" width={125} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => [`${Number(value).toFixed(2)}%`, "Recorded no-show rate"]} />
                  <Bar dataKey="no_show_rate_percent" name="No-show rate" fill="#e76f8a" radius={[0, 6, 6, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No department comparison" message="Department no-show rates will appear when population analytics are available." />
          )}
          <p className="analytics-note">Rates exclude statuses other than completed and recorded no-shows. Small denominators can cause large rate changes.</p>
        </Panel>

        <Panel
          title="Operational trends"
          subtitle="Appointment and laboratory activity over time"
          action={
            <select className="analytics-period-select" value={trendPeriod} onChange={(event) => onPeriodChange(event.target.value)} aria-label="Trend period">
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </select>
          }
        >
          {normalizedTrends.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={normalizedTrends} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={20} />
                  <YAxis allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Line type="monotone" dataKey="appointments" name="Appointments" stroke="#4776e6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="labRequests" name="Lab requests" stroke="#22a699" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Trend data unavailable" message="Check the trend endpoint response format if this chart remains empty." />
          )}
        </Panel>

        <Panel title="Intelligent insights" subtitle="Backend-generated observations for human review">
          {insightItems.length ? (
            <div className="analytics-insights-list">
              {insightItems.map((item, index) => {
                const heading = item.title ?? item.name ?? item.category ?? item.type ?? `Observation ${index + 1}`;
                const description = item.description ?? item.message ?? item.insight ?? item.recommendation ?? item.details ?? "";
                return (
                  <article className="analytics-insight-item" key={item.id ?? `${heading}-${index}`}>
                    <span className="analytics-insight-icon"><Activity size={18} /></span>
                    <div>
                      <strong>{titleCase(heading)}</strong>
                      <p>{typeof description === "string" ? description : JSON.stringify(description)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Insight format not recognized" message="The endpoint responded, but no supported list of insight items was found." />
          )}
          <p className="analytics-note">Insights are review prompts, not diagnoses or proof of a clinical quality problem.</p>
        </Panel>
      </div>

      {departments.length > 0 && (
        <Panel title="Department comparison table" subtitle="Review the counts behind the charts">
          <DataTable
            columns={[
              ["Department", (row) => row.department],
              ["Appointments", (row) => formatNumber(row.total_appointments)],
              ["Completed", (row) => formatNumber(row.completed_appointments)],
              ["Recorded no-shows", (row) => formatNumber(row.recorded_no_shows)],
              ["Completion rate", (row) => formatPercent(row.completion_rate_percent)],
              ["No-show rate", (row) => formatPercent(row.no_show_rate_percent)],
              ["No-show denominator", (row) => formatNumber(row.no_show_denominator)],
            ]}
            rows={departments}
          />
          <p className="analytics-note">
            {formatNumber(population?.appointments_without_department_mapping)} appointments lack a department mapping.
          </p>
        </Panel>
      )}

      <Panel title="Recommended review priorities" subtitle="Operational prompts, not automated clinical diagnoses">
        {dataWarnings.length ? (
          <div className="warning-list">
            {dataWarnings.map((warning) => (
              <div className={`warning-item warning-${warning.tone}`} key={warning.title}>
                <AlertTriangle size={19} />
                <div><strong>{warning.title}</strong><p>{warning.description}</p></div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No review prompts generated" message="No outstanding prompts were detected from the current summary." />
        )}
      </Panel>

      <Panel title="Dataset inventory" subtitle="Source tables available to the analytics platform">
        {Object.keys(files).length ? (
          <div className="inventory-grid">
            {Object.entries(files).map(([name, table]) => (
              <div className="inventory-card" key={name}>
                <span>{titleCase(name)}</span>
                <strong>{formatNumber(table?.rows)}</strong>
                <small>rows · {formatNumber(table?.columns)} columns</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Dataset inventory unavailable" message="The summary endpoint did not return a files or tables collection." />
        )}
      </Panel>

      <p className="footnote">
        Metrics depend on the available dataset and calculation definitions. Historical records and incomplete documentation can limit interpretation. Verify each care-gap candidate against source records before treating it as confirmed.
      </p>
    </div>
  );
}

function PatientWorkspace() {
  return <Patient360 />;
}

function AttendanceWorkspace() {
  return (
    <div className="workspace-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">POPULATION & OPERATIONS</span>
          <h1>Attendance Analytics</h1>
          <p>Analyze appointment attendance across age groups, genders, departments, and diseases.</p>
        </div>
      </div>
      <AttendanceAnalytics />
    </div>
  );
}



function groupFollowUpsByPatient(followUps) {
  const groups = new Map();

  const isClosed = (status) =>
    ["completed", "complete", "closed", "cancelled", "canceled"].includes(
      String(status ?? "").trim().toLowerCase()
    );

  const priorityRank = { high: 0, critical: 0, medium: 1, low: 2 };
  const alertRank = { high: 0, medium: 1, low: 2 };

  for (const item of followUps) {
    const patientId = String(item.patient_id ?? "unknown");

    if (!groups.has(patientId)) {
      groups.set(patientId, { patientId, items: [] });
    }

    groups.get(patientId).items.push(item);
  }

  return [...groups.values()]
    .map((group) => {
      const activeItems = group.items.filter(
        (item) => !isClosed(item.status)
      );

      const sortedItems = [...group.items].sort((a, b) => {
        const aClosed = isClosed(a.status);
        const bClosed = isClosed(b.status);

        if (aClosed !== bClosed) return aClosed ? 1 : -1;

        const aOverdue = !aClosed && Number(a.days_overdue ?? 0) > 0;
        const bOverdue = !bClosed && Number(b.days_overdue ?? 0) > 0;

        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

        const aAlert = alertRank[String(a.alert_level ?? "").toLowerCase()] ?? 3;
        const bAlert = alertRank[String(b.alert_level ?? "").toLowerCase()] ?? 3;

        if (aAlert !== bAlert) return aAlert - bAlert;

        const aPriority = priorityRank[String(a.priority ?? "").toLowerCase()] ?? 3;
        const bPriority = priorityRank[String(b.priority ?? "").toLowerCase()] ?? 3;

        if (aPriority !== bPriority) return aPriority - bPriority;

        return String(a.due_date ?? "").localeCompare(String(b.due_date ?? ""));
      });

      const highestAlertLevel =
        ["High", "Medium", "Low"].find((level) =>
          activeItems.some(
            (item) =>
              String(item.alert_level ?? "").toLowerCase() ===
              level.toLowerCase()
          )
        ) || (activeItems.length ? "Unspecified" : "Resolved");

      return {
        patientId: group.patientId,
        items: sortedItems,
        pendingCount: activeItems.length,
        totalCount: group.items.length,
        overdueCount: activeItems.filter(
          (item) => Number(item.days_overdue ?? 0) > 0
        ).length,
        highestAlertLevel,
      };
    })
    .sort((a, b) => {
      const aActive = a.pendingCount > 0;
      const bActive = b.pendingCount > 0;

      if (aActive !== bActive) return aActive ? -1 : 1;

      if (a.overdueCount !== b.overdueCount) {
        return b.overdueCount - a.overdueCount;
      }

      const aRank = alertRank[String(a.highestAlertLevel).toLowerCase()] ?? 3;
      const bRank = alertRank[String(b.highestAlertLevel).toLowerCase()] ?? 3;

      if (aRank !== bRank) return aRank - bRank;

      return a.patientId.localeCompare(b.patientId, undefined, {
        numeric: true,
      });
    });
}

function FollowUpWorkspace({ onPendingCountChange }) {
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [patientDetails, setPatientDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  
  const [expandedPatients, setExpandedPatients] = useState({});
  const togglePatient = (patientId) => {
  setExpandedPatients((previous) => ({
    ...previous,
    [patientId]: !previous[patientId],
  }));
};
  const [actionError, setActionError] = useState("");
  const [completionNotes, setCompletionNotes] = useState(
    "Follow-up contact completed; alert closed."
  );
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("All");
  const [statusMessage, setStatusMessage] = useState("");

  const isClosed = (status) =>
    ["completed", "complete", "closed", "cancelled", "canceled"].includes(
      String(status ?? "").trim().toLowerCase()
    );

  const severityClass = (level) => {
    const normalized = String(level || "Low").toLowerCase();
    return ["high", "medium", "low"].includes(normalized)
      ? normalized
      : "low";
  };

  const loadFollowUps = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await request("/api/follow-ups?include_closed=false");
      const items = Array.isArray(data)
        ? data
        : data?.follow_ups ?? data?.items ?? [];

      setFollowUps(items);

      const activeItems = items.filter((item) => !isClosed(item.status));
      onPendingCountChange?.(
        new Set(
          activeItems.map((item) => String(item.patient_id ?? "unknown"))
        ).size
      );
    } catch (err) {
      setError(err.message || "Unable to load follow-up alerts.");
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    loadFollowUps();
  }, [loadFollowUps]);

  const openDetails = async (followUp) => {
    setSelectedFollowUp(followUp);
    setPatientDetails(null);
    setActionError("");
    setStatusMessage("");
    setCompletionNotes(
      followUp.notes || "Follow-up contact completed; alert closed."
    );
    setDetailsLoading(true);

    try {
      const result = await request(
        `/api/follow-ups/${encodeURIComponent(followUp.id)}`
      );

      setSelectedFollowUp(result.follow_up ?? followUp);
      setPatientDetails({
        ...(result.patient ?? {}),
        record_counts: result.record_counts ?? {},
      });
    } catch (err) {
      setActionError(`Could not load patient details: ${err.message}`);
    } finally {
      setDetailsLoading(false);
    }
  };

  const completeFollowUp = async () => {
    if (!selectedFollowUp || actionLoading) return;

    setActionLoading(true);
    setActionError("");
    setStatusMessage("");

    try {
      await apiRequest(
        `/api/follow-ups/${encodeURIComponent(selectedFollowUp.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "Completed",
            assigned_to: selectedFollowUp.assigned_to || "Care Team",
            notes: completionNotes.trim(),
          }),
        }
      );

      setSelectedFollowUp(null);
      setPatientDetails(null);
      setStatusMessage("Follow-up marked as completed.");
      await loadFollowUps();
    } catch (err) {
      setActionError(`Could not complete this alert: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const filteredFollowUps = useMemo(() => {
    const query = search.trim().toLowerCase();

    return followUps
      .filter((item) => {
        const level = String(item.alert_level || "Low").toLowerCase();
        return levelFilter === "All" || level === levelFilter.toLowerCase();
      })
      .filter((item) => {
        if (!query) return true;

        return [
          item.id,
          item.patient_id,
          item.title,
          item.reason,
          item.priority,
          item.alert_level,
          item.assigned_to,
          item.status,
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      });
  }, [followUps, search, levelFilter]);

  const patientGroups = useMemo(
    () => groupFollowUpsByPatient(filteredFollowUps),
    [filteredFollowUps]
  );

  const levelCounts = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 };

    followUps.filter((item) => !isClosed(item.status)).forEach((item) => {
      const level = String(item.alert_level || "Low").toLowerCase();
      if (level === "high") counts.High += 1;
      else if (level === "medium") counts.Medium += 1;
      else counts.Low += 1;
    });

    return counts;
  }, [followUps]);

  const severityData = [
    { name: "High", count: levelCounts.High, color: "#d95757" },
    { name: "Medium", count: levelCounts.Medium, color: "#e5a13c" },
    { name: "Low", count: levelCounts.Low, color: "#20a486" },
  ];

  const activeFollowUps = followUps.filter((item) => !isClosed(item.status));
  const overdueCount = activeFollowUps.filter(
    (item) => Number(item.days_overdue ?? 0) > 0
  ).length;

  const patientName = patientDetails
    ? [
        patientDetails.first_name,
        patientDetails.last_name,
      ].filter(Boolean).join(" ") || "Name unavailable"
    : "Patient details unavailable";

  const isCompleted = isClosed(selectedFollowUp?.status);

  const closeModal = () => {
    if (actionLoading) return;
    setSelectedFollowUp(null);
    setPatientDetails(null);
    setActionError("");
  };

  return (
    <div className="workspace-content followup-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CARE COORDINATION</span>
          <h1>Follow-up Alerts</h1>
          <p>
            Track pending patient contacts, review patient details, and
            record completed follow-ups.
          </p>
        </div>

        <button
          type="button"
          className="button button-secondary"
          onClick={loadFollowUps}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          Refresh alerts
        </button>
      </div>

      {error && (
        <div className="followup-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button
            type="button"
            className="button button-secondary"
            onClick={loadFollowUps}
          >
            Retry
          </button>
        </div>
      )}

      {statusMessage && (
        <div className="followup-success" role="status">
          <CheckCircle2 size={18} />
          {statusMessage}
        </div>
      )}

      <div className="metric-grid followup-metrics">
        <MetricCard
          icon={BellRing}
          label="Active follow-ups"
          value={loading ? "…" : activeFollowUps.length.toLocaleString()}
          description="Pending alert records"
          tone="blue"
        />
        <MetricCard
          icon={CircleAlert}
          label="High alert level"
          value={levelCounts.High}
          description="Active alerts labelled High by the backend"
          tone="orange"
        />
        <MetricCard
          icon={Clock3}
          label="Overdue follow-ups"
          value={overdueCount}
          description="Active records with positive days overdue"
          tone="purple"
        />
      </div>

      <div className="chart-grid followup-chart-grid">
        <Panel title="Active alerts by level" subtitle="Backend-provided alert levels">
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={severityData}
                margin={{ top: 15, right: 15, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Active alerts" radius={[7, 7, 0, 0]}>
                  {severityData.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Alert distribution" subtitle="Pending alerts by backend alert level">
          <div className="chart-area chart-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={severityData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  stroke="none"
                >
                  {severityData.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend verticalAlign="bottom" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel
        title="Patient follow-up worklist"
        subtitle="Alerts are grouped by patient. Open an alert to review its details."
      >
        <div className="followup-toolbar">
          <label className="gap-search">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient ID, reason, or alert..."
              aria-label="Search follow-up alerts"
            />
            {search && (
              <button
                type="button"
                className="clear-search"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </label>

          <label className="filter-control">
            <span>Alert level</span>
            <select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value)}
            >
              <option>All</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
        </div>

        {loading ? (
          <EmptyState
            title="Loading follow-ups"
            message="Retrieving active alerts from the CareLens API."
          />
        ) : !patientGroups.length ? (
          <EmptyState
            title={followUps.length ? "No matching alerts" : "No active follow-ups"}
            message={
              followUps.length
                ? "Try another search term or alert level."
                : "No pending follow-ups were returned by the backend."
            }
          />
        ) : (
<div className="followup-list">
  {patientGroups.map((group) => {
    const patientId = String(group.patientId);
    const expanded = Boolean(expandedPatients[patientId]);

    return (
      <article
        className={`followup-patient-group ${
          expanded ? "is-expanded" : ""
        }`}
        key={patientId}
      >
        <button
          type="button"
          className="followup-patient-group-header"
          onClick={() => togglePatient(patientId)}
          aria-expanded={expanded}
          aria-controls={`patient-alerts-${patientId}`}
        >
          <div className="followup-group-avatar">
            <UserRound size={21} />
          </div>

          <div className="followup-group-heading">
            <h3>Patient {patientId}</h3>
            <p>
              {group.pendingCount} active · {group.totalCount} alert(s)
              {group.overdueCount > 0
                ? ` · ${group.overdueCount} overdue`
                : ""}
            </p>
          </div>

          <span
            className={`followup-level level-${severityClass(
              group.highestAlertLevel
            )}`}
          >
            {group.highestAlertLevel}
          </span>

          <span className="followup-patient-toggle">
            {expanded ? (
              <ChevronUp size={19} />
            ) : (
              <ChevronDown size={19} />
            )}
          </span>
        </button>

        {expanded && (
          <div
            className="followup-group-items"
            id={`patient-alerts-${patientId}`}
          >
            {group.items.map((item) => {
              const completed = isClosed(item.status);
              const overdue =
                !completed && Number(item.days_overdue ?? 0) > 0;

              return (
                <div className="followup-group-item" key={item.id}>
                  <div className="followup-group-item-icon">
                    {completed ? (
                      <CheckCircle2 size={19} />
                    ) : overdue ? (
                      <AlertTriangle size={19} />
                    ) : (
                      <BellRing size={19} />
                    )}
                  </div>

                  <div className="followup-group-item-content">
                    <div className="followup-item-title">
                      <strong>
                        {item.title || "Follow-up contact"}
                      </strong>

                      <span
                        className={`followup-level level-${severityClass(
                          item.alert_level
                        )}`}
                      >
                        {item.alert_level || "Unspecified"}
                      </span>
                    </div>

                    <p>{item.reason || "No reason recorded."}</p>

                    <div className="followup-item-meta">
                      <span>
                        <CalendarDays size={14} />
                        Due {item.due_date || "Date unavailable"}
                      </span>

                      <span>
                        <Clock3 size={14} />
                        {completed
                          ? titleCase(item.status)
                          : overdue
                            ? `${item.days_overdue} day(s) overdue`
                            : "Not overdue"}
                      </span>

                      <span>
                        Priority: {item.priority || "Not specified"}
                      </span>

                      <span>Status: {titleCase(item.status)}</span>

                      <span>
                        Assigned: {item.assigned_to || "Care Team"}
                      </span>
                    </div>

                    <div className="followup-item-actions">
                      <button
                        type="button"
                        className="button button-secondary followup-view-button"
                        onClick={() => openDetails(item)}
                      >
                        View details
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>
    );
  })}
</div>
        )}
      </Panel>

      {selectedFollowUp && (
        <div
          className="followup-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className="followup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="followup-modal-title"
          >
            <div className="followup-modal-header">
              <div>
                <span className="eyebrow">FOLLOW-UP DETAILS</span>
                <h2 id="followup-modal-title">
                  {selectedFollowUp.title || "Follow-up contact"}
                </h2>
              </div>

              <button
                type="button"
                className="icon-button"
                aria-label="Close details"
                disabled={actionLoading}
                onClick={closeModal}
              >
                <X size={18} />
              </button>
            </div>

            {detailsLoading ? (
              <EmptyState
                title="Loading patient information"
                message="Fetching the alert and patient record."
              />
            ) : (
              <>
                {actionError && (
                  <div className="followup-error" role="alert">
                    <AlertTriangle size={17} />
                    <span>{actionError}</span>
                  </div>
                )}

                <div className="followup-modal-patient">
                  <div className="followup-patient-avatar">
                    <UserRound size={24} />
                  </div>
                  <div>
                    <strong>{patientName}</strong>
                    <span>Patient ID: {selectedFollowUp.patient_id}</span>
                  </div>
                  <span
                    className={`followup-level level-${severityClass(selectedFollowUp.alert_level)}`}
                  >
                    {selectedFollowUp.alert_level || "Low"}
                  </span>
                </div>

                <div className="followup-patient-contact">
                  <div>
                    <Phone size={16} />
                    <span>
                      <small>Phone</small>
                      <strong>{patientDetails?.phone || "Not recorded"}</strong>
                    </span>
                  </div>
                  <div>
                    <MapPin size={16} />
                    <span>
                      <small>Address</small>
                      <strong>{patientDetails?.address || "Not recorded"}</strong>
                    </span>
                  </div>
                </div>

                <div className="followup-detail-grid">
                  <div>
                    <small>Reason for follow-up</small>
                    <p>{selectedFollowUp.reason || "No reason recorded."}</p>
                  </div>
                  <div>
                    <small>Due date</small>
                    <p>{selectedFollowUp.due_date || "Not recorded"}</p>
                  </div>
                  <div>
                    <small>Priority</small>
                    <p>{selectedFollowUp.priority || "Not specified"}</p>
                  </div>
                  <div>
                    <small>Assigned to</small>
                    <p>{selectedFollowUp.assigned_to || "Care Team"}</p>
                  </div>
                  <div>
                    <small>Status</small>
                    <p>{titleCase(selectedFollowUp.status)}</p>
                  </div>
                  <div>
                    <small>Days overdue</small>
                    <p>
                      {isClosed(selectedFollowUp.status)
                        ? "—"
                        : Number(selectedFollowUp.days_overdue ?? 0)}
                    </p>
                  </div>
                </div>

                {!isCompleted && (
                  <label className="followup-notes-field">
                    <span>Completion notes</span>
                    <textarea
                      rows={3}
                      value={completionNotes}
                      onChange={(event) => setCompletionNotes(event.target.value)}
                      placeholder="Document the outcome of the follow-up..."
                    />
                  </label>
                )}

                <div className="followup-modal-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={actionLoading}
                    onClick={closeModal}
                  >
                    Close
                  </button>

                  {!isCompleted && (
                    <button
                      type="button"
                      className="button button-complete"
                      disabled={actionLoading || detailsLoading}
                      onClick={completeFollowUp}
                    >
                      <CheckCheck size={17} />
                      {actionLoading ? "Saving..." : "Mark completed"}
                    </button>
                  )}

                  {isCompleted && (
                    <span className="followup-completed-label">
                      <Check size={16} />
                      Completed
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}


function App() {
  const [activeView, setActiveView] = useState("quality");
  const [metrics, setMetrics] = useState({});
  const [summary, setSummary] = useState({});
  const [validation, setValidation] = useState({});
  const [gaps, setGaps] = useState([]);
  const [population, setPopulation] = useState(null);
  const [trends, setTrends] = useState(null);
  const [insights, setInsights] = useState(null);
  const [trendPeriod, setTrendPeriod] = useState("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingFollowUpCount, setPendingFollowUpCount] = useState(0);
  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    const endpoints = [
      ["/api/metrics", "metrics"],
      ["/api/data/summary", "summary"],
      ["/api/data/validation", "validation"],
      ["/api/care-gaps", "gaps"],
      ["/api/analytics/population", "population"],
      [`/api/analytics/trends?period=${trendPeriod}`, "trends"],
      ["/api/analytics/insights", "insights"],
    ];

    const setters = {
      metrics: setMetrics,
      summary: setSummary,
      validation: setValidation,
      population: setPopulation,
      trends: setTrends,
      insights: setInsights,
    };

    try {
      const results = await Promise.allSettled(
        endpoints.map(([path]) => request(path))
      );
      const failures = [];

      results.forEach((result, index) => {
        const [path, key] = endpoints[index];

        if (result.status === "rejected") {
          failures.push(`${path}: ${result.reason?.message || "Request failed"}`);
          if (key === "gaps") setGaps([]);
          else setters[key]?.(null);
          return;
        }

        const value = result.value;

        if (key === "metrics") {
          setMetrics(value?.metrics ?? value ?? {});
        } else if (key === "gaps") {
          const rawGaps = Array.isArray(value)
            ? value
            : value?.care_gaps ?? value?.gaps ?? value?.items ?? [];
          setGaps(rawGaps.map(normalizeGap));
        } else {
          setters[key]?.(value ?? {});
        }
      });

      if (failures.length) {
        setError(`Some dashboard sections could not load: ${failures.join(" | ")}`);
      }
    } catch (loadError) {
      setError(loadError.message || "Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [trendPeriod]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const viewLabel = {
    quality: "Quality Intelligence",
    attendance: "Attendance Analytics",
    patient: "Patient 360",
    followups: "Follow-up Alerts",
  }[activeView];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><HeartPulse size={24} /></div>
          <div><strong>CareLens</strong><span>Value-Based Care Analytics</span></div>
        </div>

        <div className="sidebar-label">WORKSPACES</div>

        <button className={`nav-item ${activeView === "quality" ? "active" : ""}`} onClick={() => setActiveView("quality")}>
          <LayoutDashboard size={19} /><span>Quality Intelligence</span>
        </button>
        <button className={`nav-item ${activeView === "attendance" ? "active" : ""}`} onClick={() => setActiveView("attendance")}>
          <CalendarDays size={19} /><span>Attendance Analytics</span>
        </button>
        <button className={`nav-item ${activeView === "patient" ? "active" : ""}`} onClick={() => setActiveView("patient")}>
          <Users size={19} /><span>Patient 360</span>
        </button>
        <button
  className={`nav-item ${activeView === "followups" ? "active" : ""}`}
  onClick={() => setActiveView("followups")}
>
  <BellRing size={19} />
  <span>Follow-up Alerts</span>
  {pendingFollowUpCount > 0 && (
    <span className="nav-count">{pendingFollowUpCount}</span>
  )}
</button>
        <div className="sidebar-bottom">
          <div className="system-status">
            <span className="status-indicator" />
            <div><strong>Analytics workspace</strong><small>API-backed insights</small></div>
          </div>
          <p>CareLens · Value-based care</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">CareLens <span>/</span> {viewLabel}</div>
          <div className="topbar-actions">
            <span className="live-label"><span className="status-indicator" />API connected</span>
            <button className="icon-button" onClick={loadDashboard} aria-label="Refresh dashboard" title="Refresh dashboard data">
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
    gaps={gaps}
    loading={loading}
    onRefresh={loadDashboard}
    population={population}
    trends={trends}
    insights={insights}
    trendPeriod={trendPeriod}
    onPeriodChange={setTrendPeriod}
  />
) : activeView === "attendance" ? (
  <AttendanceWorkspace />
) : activeView === "patient" ? (
  <PatientWorkspace />
) : activeView === "followups" ? (
  <FollowUpWorkspace
    onPendingCountChange={setPendingFollowUpCount}
  />
) : null}


        <footer className="app-footer">
          <span>CareLens Analytics</span>
          <span>Insights support review; clinical decisions remain with care teams.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
