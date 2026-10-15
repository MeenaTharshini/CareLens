// frontend/src/App.jsx

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Database,
  Download,
  FileCheck2,
  HeartPulse,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import "./App.css";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const COLORS = {
  blue: "#4678E8",
  green: "#169B75",
  orange: "#E9A23B",
  red: "#D95362",
  purple: "#8666D8",
  navy: "#172B4D",
  muted: "#7B879B",
};

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "gaps", label: "Care-gap worklist", icon: ClipboardCheck },
  { id: "quality", label: "Data quality", icon: ShieldCheck },
];

const CHART_COLORS = [COLORS.green, COLORS.orange, COLORS.blue];

async function fetchJson(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`);

  if (!response.ok) {
    throw new Error(`${endpoint} returned HTTP ${response.status}`);
  }

  return response.json();
}

function unwrapArray(value) {
  if (Array.isArray(value)) return value;

  for (const key of [
    "items",
    "results",
    "care_gaps",
    "gaps",
    "records",
    "data",
  ]) {
    if (Array.isArray(value?.[key])) return value[key];
  }

  return [];
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "—";

  const number = Number(value);
  if (!Number.isFinite(number)) return "—";

  return number.toLocaleString("en-IN", {
    maximumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";

  const number = Number(value);
  return Number.isFinite(number) ? `${formatNumber(number, digits)}%` : "—";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getGapId(gap) {
  return (
    gap.id ??
    gap.appointment_id ??
    gap.request_id ??
    gap.lab_request_id ??
    "—"
  );
}

function getGapType(gap) {
  const raw =
    gap.gap_type ??
    gap.candidate_type ??
    gap.type ??
    gap.category ??
    gap.reason ??
    "Review candidate";

  return String(raw).replaceAll("_", " ");
}

function getGapDate(gap) {
  return (
    gap.date ??
    gap.appointment_date ??
    gap.request_date ??
    gap.created_at ??
    null
  );
}

function getGapReason(gap) {
  return (
    gap.reason ??
    gap.description ??
    gap.evidence ??
    "Requires human review"
  );
}

function getGapStatus(gap) {
  return gap.review_status ?? gap.status ?? "Pending review";
}

function getGapSearchText(gap) {
  return [
    getGapId(gap),
    gap.patient_id,
    getGapType(gap),
    getGapDate(gap),
    getGapReason(gap),
    getGapStatus(gap),
  ]
    .map((value) => String(value ?? ""))
    .join(" ")
    .toLowerCase();
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  color,
  loading,
}) {
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        <span className="metric-title">{title}</span>
        <span
          className="metric-icon"
          style={{ color, backgroundColor: `${color}14` }}
        >
          <Icon size={19} />
        </span>
      </div>

      <div className="metric-value">
        {loading ? (
          <LoaderCircle size={23} className="spin" />
        ) : (
          value
        )}
      </div>

      <p className="metric-description">{description}</p>
    </article>
  );
}

function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        </div>
        {action && <div className="panel-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ status }) {
  const normalized = String(status ?? "").toLowerCase();

  let variant = "pending";

  if (
    normalized.includes("pass") ||
    normalized.includes("complete") ||
    normalized.includes("valid") ||
    normalized.includes("resolved") ||
    normalized.includes("closed")
  ) {
    variant = "success";
  } else if (
    normalized.includes("fail") ||
    normalized.includes("invalid") ||
    normalized.includes("error")
  ) {
    variant = "danger";
  } else if (
    normalized.includes("unavailable") ||
    normalized.includes("not reported")
  ) {
    variant = "neutral";
  }

  return (
    <span className={`status-pill ${variant}`}>
      {status || "Pending review"}
    </span>
  );
}

function EmptyState({ icon: Icon = FileCheck2, title, description }) {
  return (
    <div className="empty-state">
      <Icon size={29} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function DataTable({ children }) {
  return (
    <div className="table-wrap">
      <table className="data-table">{children}</table>
    </div>
  );
}

function makeValidationIssues(validation) {
  const reports = validation?.report;
  if (!reports || typeof reports !== "object") return [];

  return Object.entries(reports).flatMap(([table, details]) => {
    if (!details || typeof details !== "object") return [];

    const issues = [];
    const missing = Number(details.missing_cells ?? 0);

    if (missing > 0) {
      const columns = Object.entries(details.missing_by_column ?? {})
        .filter(([, count]) => Number(count) > 0)
        .map(([column, count]) => `${column}: ${count}`)
        .join(", ");

      issues.push({
        table,
        issue: "Missing data",
        count: missing,
        details: columns || "Missing values detected",
      });
    }

    const duplicateRows = Number(details.duplicate_rows ?? 0);
    if (duplicateRows > 0) {
      issues.push({
        table,
        issue: "Duplicate rows",
        count: duplicateRows,
        details: "Duplicate records need review.",
      });
    }

    const duplicateIds = Number(details.duplicate_ids ?? 0);
    if (duplicateIds > 0) {
      issues.push({
        table,
        issue: "Duplicate IDs",
        count: duplicateIds,
        details: "Duplicate identifiers need review.",
      });
    }

    const missingStatuses = Number(details.missing_statuses ?? 0);
    if (missingStatuses > 0) {
      issues.push({
        table,
        issue: "Missing statuses",
        count: missingStatuses,
        details: "Records have no status.",
      });
    }

    if (
      Array.isArray(details.unknown_statuses) &&
      details.unknown_statuses.length > 0
    ) {
      issues.push({
        table,
        issue: "Unknown statuses",
        count: details.unknown_statuses.length,
        details: details.unknown_statuses.join(", "),
      });
    }

    return issues;
  });
}

function downloadCsv(gaps) {
  const headers = [
    "Record ID",
    "Patient ID",
    "Candidate type",
    "Date",
    "Reason",
    "Review status",
  ];

  const escapeCsv = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const rows = gaps.map((gap) => [
    getGapId(gap),
    gap.patient_id ?? "",
    getGapType(gap),
    getGapDate(gap) ?? "",
    getGapReason(gap),
    getGapStatus(gap),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");

  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "carelens-care-gap-candidates.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [activePage, setActivePage] = useState("overview");
  const [metrics, setMetrics] = useState(null);
  const [summary, setSummary] = useState(null);
  const [validation, setValidation] = useState(null);
  const [relationships, setRelationships] = useState(null);
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch] = useState("");
  const [gapFilter, setGapFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    const endpoints = [
      ["/api/metrics", setMetrics],
      ["/api/data/summary", setSummary],
      ["/api/data/validation", setValidation],
      ["/api/data/relationships", setRelationships],
      ["/api/care-gaps", (value) => setGaps(unwrapArray(value))],
    ];

    const results = await Promise.allSettled(
      endpoints.map(([endpoint]) => fetchJson(endpoint))
    );

    let failures = 0;

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        endpoints[index][1](result.value);
      } else {
        failures += 1;
        console.error(
          `CareLens request failed: ${endpoints[index][0]}`,
          result.reason
        );
      }
    });

    if (failures === endpoints.length) {
      setError(
        "The CareLens API could not be reached. Start the FastAPI backend and check the API URL."
      );
    } else if (failures > 0) {
      setError(
        `${failures} API request(s) failed. Some sections may be unavailable. Check the browser console and backend endpoints.`
      );
    }

    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const summaryTables = useMemo(() => {
    if (!summary?.files || typeof summary.files !== "object") return [];

    return Object.entries(summary.files).map(([name, details]) => ({
      name,
      rows: details?.rows ?? 0,
      columns: details?.columns ?? 0,
      columnNames: details?.column_names ?? [],
    }));
  }, [summary]);

  const validationIssues = useMemo(
    () => makeValidationIssues(validation),
    [validation]
  );

  const relationshipReport = useMemo(
    () => (Array.isArray(relationships?.report) ? relationships.report : []),
    [relationships]
  );

  const relationshipPassed = useMemo(() => {
    if (relationshipReport.length === 0) return null;

    return relationshipReport.every(
      (item) => item.status === "passed" &&
        Number(item.missing_foreign_keys ?? 0) === 0 &&
        Number(item.unmatched_foreign_keys ?? 0) === 0
    );
  }, [relationshipReport]);

  const metricsReady = metrics !== null;

  const appointmentCompletion = metrics?.appointment_completion_rate_percent;
  const noShowRate = metrics?.appointment_no_show_rate_percent;
  const labAvailability = metrics?.lab_result_availability_percent;
  const medianTurnaround = metrics?.median_lab_turnaround_days;
  const completeness = metrics?.data_completeness_percent;
  const appointmentTotal = metrics?.all_appointment_records;
  const noShowCount = metrics?.recorded_no_shows;
  const completionCount = metrics?.completed_appointments;
  const missingCells = metrics?.total_missing_cells;

  const candidateCount = gaps.length;

  const appointmentChartData = useMemo(() => {
    if (!metrics) return [];

    const completed = Number(metrics.completed_appointments ?? 0);
    const noShows = Number(metrics.recorded_no_shows ?? 0);
    const total = Number(metrics.all_appointment_records ?? 0);
    const other = Math.max(0, total - completed - noShows);

    return [
      { name: "Completed", value: completed },
      { name: "No-show", value: noShows },
      { name: "Other / remaining", value: other },
    ].filter((item) => item.value > 0);
  }, [metrics]);

  const filteredGaps = useMemo(() => {
    const term = search.trim().toLowerCase();

    return gaps.filter((gap) => {
      const type = getGapType(gap).toLowerCase();
      const status = String(getGapStatus(gap)).toLowerCase();

      const matchesSearch = !term || getGapSearchText(gap).includes(term);

      const matchesFilter =
        gapFilter === "all" ||
        (gapFilter === "no_show" &&
          (type.includes("no show") || type.includes("no_show"))) ||
        (gapFilter === "lab" &&
          (type.includes("lab") || type.includes("result"))) ||
        (gapFilter === "reviewed" &&
          (status.includes("reviewed") ||
            status.includes("resolved") ||
            status.includes("closed")));

      return matchesSearch && matchesFilter;
    });
  }, [gaps, search, gapFilter]);

  const navigate = (page) => {
    setActivePage(page);
    setSidebarOpen(false);
  };

  const refreshButton = (
    <button
      type="button"
      className="button button-secondary"
      onClick={loadDashboard}
      disabled={loading}
    >
      <RefreshCw size={15} className={loading ? "spin" : ""} />
      Refresh
    </button>
  );

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <HeartPulse size={24} />
          </div>
          <div className="brand-copy">
            <div className="brand-name">CareLens</div>
            <div className="brand-subtitle">QUALITY INTELLIGENCE</div>
          </div>
          <button
            type="button"
            className="icon-button sidebar-close"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>

        <nav className="nav-list" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`nav-item ${activePage === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "gaps" && candidateCount > 0 && (
                <span className="nav-count">{candidateCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="evidence-card">
            <div className="evidence-title">
              <ShieldCheck size={18} />
              <span>Evidence-first analytics</span>
            </div>
            <p>
              Flags support human review. They do not independently establish
              a clinical care failure.
            </p>
          </div>

          <div className="team-card">
            <div className="team-avatar">
              <Stethoscope size={18} />
            </div>
            <div>
              <div className="team-name">CareLens Team</div>
              <div className="team-subtitle">Quality workspace</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div>
              <div className="breadcrumb">
                CareLens / {NAV_ITEMS.find((item) => item.id === activePage)?.label}
              </div>
              <h1 className="page-title">
                {activePage === "overview"
                  ? "Quality overview"
                  : activePage === "gaps"
                    ? "Care-gap worklist"
                    : "Data quality"}
              </h1>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="connection-status">
              <span
                className={`connection-dot ${
                  error ? "warning" : loading ? "loading" : "connected"
                }`}
              />
              {error ? "Check API status" : loading ? "Updating…" : "API connected"}
            </div>
            {refreshButton}
          </div>
        </header>

        {error && (
          <div className="alert-banner" role="alert">
            <AlertTriangle size={19} />
            <div>
              <strong>Data connection warning</strong>
              <p>{error}</p>
              <small>API base URL: {API_BASE}</small>
            </div>
          </div>
        )}

        {activePage === "overview" && (
          <>
            <div className="section-heading">
              <div>
                <h2>Healthcare quality indicators</h2>
                <p>Metrics calculated from the available dataset.</p>
              </div>
              <div className="updated-at">
                <Activity size={15} />
                {lastUpdated
                  ? `Updated ${lastUpdated.toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "Waiting for data"}
              </div>
            </div>

            <div className="metric-grid">
              <MetricCard
                title="Appointment completion"
                value={formatPercent(appointmentCompletion)}
                description={`${formatNumber(completionCount, 0)} completed out of ${formatNumber(appointmentTotal, 0)} records`}
                icon={CheckCircle2}
                color={COLORS.green}
                loading={loading && !metricsReady}
              />
              <MetricCard
                title="Recorded no-show rate"
                value={formatPercent(noShowRate)}
                description={`${formatNumber(noShowCount, 0)} recorded no-shows; denominator ${formatNumber(metrics?.no_show_rate_denominator, 0)}`}
                icon={Users}
                color={COLORS.orange}
                loading={loading && !metricsReady}
              />
              <MetricCard
                title="Lab result availability"
                value={formatPercent(labAvailability)}
                description={`${formatNumber(metrics?.lab_requests_with_linked_results, 0)} of ${formatNumber(metrics?.total_lab_requests, 0)} requests linked to results`}
                icon={FileCheck2}
                color={COLORS.blue}
                loading={loading && !metricsReady}
              />
              <MetricCard
                title="Median lab turnaround"
                value={
                  medianTurnaround == null
                    ? "—"
                    : `${formatNumber(medianTurnaround, 2)} days`
                }
                description={`${formatNumber(metrics?.valid_lab_turnaround_requests, 0)} valid request-to-result intervals`}
                icon={Activity}
                color={COLORS.purple}
                loading={loading && !metricsReady}
              />
              <MetricCard
                title="Data completeness"
                value={formatPercent(completeness)}
                description="Populated cells / all cells"
                icon={Database}
                color={COLORS.green}
                loading={loading && !metricsReady}
              />
              <MetricCard
                title="Care-gap candidates"
                value={formatNumber(candidateCount, 0)}
                description="Returned records flagged for human review"
                icon={AlertCircle}
                color={COLORS.red}
                loading={loading}
              />
              <MetricCard
                title="Appointment records"
                value={formatNumber(appointmentTotal, 0)}
                description="Records available for analysis"
                icon={ClipboardCheck}
                color={COLORS.blue}
                loading={loading && !metricsReady}
              />
              <MetricCard
                title="Missing data cells"
                value={formatNumber(missingCells, 0)}
                description="Inspect the validation findings for context"
                icon={AlertTriangle}
                color={COLORS.orange}
                loading={loading && !metricsReady}
              />
            </div>

            <div className="overview-panels">
              <Panel
                title="Appointment distribution"
                subtitle="Completed and no-show records, with remaining statuses shown separately"
              >
                {appointmentChartData.length > 0 ? (
                  <>
                    <div className="chart-area">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={appointmentChartData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={62}
                            outerRadius={94}
                            paddingAngle={3}
                          >
                            {appointmentChartData.map((entry, index) => (
                              <Cell
                                key={entry.name}
                                fill={CHART_COLORS[index % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, name) => [
                              formatNumber(value, 0),
                              name,
                            ]}
                            contentStyle={{
                              border: "1px solid #E8ECF3",
                              borderRadius: 10,
                              fontSize: 12,
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="chart-legend">
                      {appointmentChartData.map((entry, index) => (
                        <div className="legend-item" key={entry.name}>
                          <span
                            className="legend-dot"
                            style={{
                              background:
                                CHART_COLORS[index % CHART_COLORS.length],
                            }}
                          />
                          <span>{entry.name}</span>
                          <strong>{formatNumber(entry.value, 0)}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="chart-note">
                      This chart summarizes recorded appointment statuses; it
                      does not measure clinical outcomes.
                    </p>
                  </>
                ) : (
                  <EmptyState
                    icon={Activity}
                    title="Appointment data unavailable"
                    description="Check the /api/metrics response."
                  />
                )}
              </Panel>

              <Panel
                title="Data-quality snapshot"
                subtitle="Checks returned by the validation and relationship APIs"
              >
                <div className="quality-summary-list">
                  <div className="quality-summary-row">
                    <span className="summary-icon green">
                      <ShieldCheck size={18} />
                    </span>
                    <div className="summary-copy">
                      <strong>Relationship validation</strong>
                      <span>Foreign-key consistency checks</span>
                    </div>
                    <div className="summary-value">
                      <StatusPill
                        status={
                          relationshipPassed === null
                            ? "Unavailable"
                            : relationshipPassed
                              ? "Passed"
                              : "Review"
                        }
                      />
                      {relationshipReport.length > 0 && (
                        <small>
                          {relationshipReport.filter(
                            (item) => item.status === "passed"
                          ).length}
                          /{relationshipReport.length}
                        </small>
                      )}
                    </div>
                  </div>

                  <div className="quality-summary-row">
                    <span className="summary-icon orange">
                      <AlertTriangle size={18} />
                    </span>
                    <div className="summary-copy">
                      <strong>Validation findings</strong>
                      <span>Missing data and structural issues</span>
                    </div>
                    <strong className="summary-number">
                      {validation ? validationIssues.length : "—"}
                    </strong>
                  </div>

                  <div className="quality-summary-row">
                    <span className="summary-icon blue">
                      <Database size={18} />
                    </span>
                    <div className="summary-copy">
                      <strong>Source tables</strong>
                      <span>Tables exposed by the summary endpoint</span>
                    </div>
                    <strong className="summary-number">
                      {summary ? summaryTables.length : "—"}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="button button-secondary button-full"
                  onClick={() => navigate("quality")}
                >
                  View data quality <ArrowUpRight size={15} />
                </button>
              </Panel>
            </div>

            <div className="section-gap">
              <Panel
                title="Care-gap candidates"
                subtitle="Records that may require investigation"
                action={
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => navigate("gaps")}
                  >
                    View worklist <ArrowUpRight size={15} />
                  </button>
                }
              >
                {gaps.length > 0 ? (
                  <DataTable>
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Candidate type</th>
                        <th>Date</th>
                        <th>Reason / evidence</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gaps.slice(0, 5).map((gap, index) => (
                        <tr key={`${getGapId(gap)}-${index}`}>
                          <td className="strong-cell">{getGapId(gap)}</td>
                          <td className="capitalize">{getGapType(gap)}</td>
                          <td>{formatDate(getGapDate(gap))}</td>
                          <td>{getGapReason(gap)}</td>
                          <td><StatusPill status={getGapStatus(gap)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                ) : (
                  <EmptyState
                    icon={ClipboardCheck}
                    title={loading ? "Loading worklist…" : "No worklist records returned"}
                    description="Check the /api/care-gaps endpoint and its response format."
                  />
                )}
              </Panel>
            </div>
          </>
        )}

        {activePage === "gaps" && (
          <>
            <div className="mini-stat-grid">
              <div className="mini-stat-card">
                <ClipboardCheck color={COLORS.blue} size={21} />
                <span>Total candidates</span>
                <strong>{formatNumber(candidateCount, 0)}</strong>
              </div>
              <div className="mini-stat-card">
                <Users color={COLORS.orange} size={21} />
                <span>Recorded no-shows</span>
                <strong>{formatNumber(noShowCount, 0)}</strong>
              </div>
              <div className="mini-stat-card">
                <FileCheck2 color={COLORS.purple} size={21} />
                <span>Lab requests</span>
                <strong>{formatNumber(metrics?.total_lab_requests, 0)}</strong>
              </div>
            </div>

            <Panel
              title="Review worklist"
              subtitle="Investigate flagged records; candidates are not confirmed care failures."
              action={
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => downloadCsv(filteredGaps)}
                  disabled={filteredGaps.length === 0}
                >
                  <Download size={15} /> Export CSV
                </button>
              }
            >
              <div className="worklist-controls">
                <div className="search-field">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search record, patient ID or reason…"
                    aria-label="Search care-gap candidates"
                  />
                  {search && (
                    <button
                      type="button"
                      className="search-clear"
                      aria-label="Clear search"
                      onClick={() => setSearch("")}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>

                <div className="select-field">
                  <select
                    value={gapFilter}
                    onChange={(event) => setGapFilter(event.target.value)}
                    aria-label="Filter care-gap candidates"
                  >
                    <option value="all">All candidates</option>
                    <option value="no_show">No-show appointments</option>
                    <option value="lab">Lab-result candidates</option>
                    <option value="reviewed">Reviewed / resolved</option>
                  </select>
                  <ChevronDown size={15} />
                </div>
              </div>

              {filteredGaps.length > 0 ? (
                <DataTable>
                  <thead>
                    <tr>
                      <th>Record ID</th>
                      <th>Patient ID</th>
                      <th>Candidate type</th>
                      <th>Date</th>
                      <th>Reason / evidence</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGaps.map((gap, index) => (
                      <tr key={`${getGapId(gap)}-${index}`}>
                        <td className="strong-cell">{getGapId(gap)}</td>
                        <td>{gap.patient_id ?? "—"}</td>
                        <td className="capitalize">{getGapType(gap)}</td>
                        <td>{formatDate(getGapDate(gap))}</td>
                        <td>{getGapReason(gap)}</td>
                        <td><StatusPill status={getGapStatus(gap)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              ) : (
                <EmptyState
                  icon={Search}
                  title={gaps.length ? "No matching candidates" : "No worklist records returned"}
                  description={
                    gaps.length
                      ? "Try a different search term or filter."
                      : "Check /api/care-gaps and its response format."
                  }
                />
              )}

              <div className="table-footer">
                Showing {filteredGaps.length} of {gaps.length} returned candidates.
              </div>
            </Panel>
          </>
        )}

        {activePage === "quality" && (
          <>
            <div className="mini-stat-grid">
              <div className="mini-stat-card">
                <Database color={COLORS.blue} size={21} />
                <span>Data completeness</span>
                <strong>{formatPercent(completeness)}</strong>
              </div>
              <div className="mini-stat-card">
                <AlertTriangle color={COLORS.orange} size={21} />
                <span>Missing data cells</span>
                <strong>{formatNumber(missingCells, 0)}</strong>
              </div>
              <div className="mini-stat-card">
                <ShieldCheck
                  color={relationshipPassed ? COLORS.green : COLORS.orange}
                  size={21}
                />
                <span>Relationship validation</span>
                <strong className="mini-stat-text">
                  {relationshipPassed === null
                    ? "Not reported"
                    : relationshipPassed
                      ? "4 / 4 passed"
                      : "Needs review"}
                </strong>
              </div>
            </div>

            <div className="quality-page-stack">
              <Panel
                title="Validation findings"
                subtitle="Findings reported by the backend. Missing values should be interpreted in context."
              >
                {validationIssues.length > 0 ? (
                  <DataTable>
                    <thead>
                      <tr>
                        <th>Table</th>
                        <th>Issue</th>
                        <th>Count</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validationIssues.map((issue, index) => (
                        <tr key={`${issue.table}-${issue.issue}-${index}`}>
                          <td className="strong-cell">{issue.table}</td>
                          <td>{issue.issue}</td>
                          <td>{formatNumber(issue.count, 0)}</td>
                          <td>{issue.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                ) : (
                  <EmptyState
                    icon={ShieldCheck}
                    title={
                      validation
                        ? "No reported structural findings"
                        : "Validation data unavailable"
                    }
                    description={
                      validation
                        ? "No duplicate IDs, duplicate rows, or status issues were reported. Missing cells are also checked."
                        : "Check /api/data/validation."
                    }
                  />
                )}
              </Panel>

              <Panel
                title="Source data summary"
                subtitle="Table sizes reported by the backend"
              >
                {summaryTables.length > 0 ? (
                  <DataTable>
                    <thead>
                      <tr>
                        <th>Dataset table</th>
                        <th>Records</th>
                        <th>Columns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryTables.map((table) => (
                        <tr key={table.name}>
                          <td className="strong-cell capitalize">
                            {table.name.replaceAll("_", " ")}
                          </td>
                          <td>{formatNumber(table.rows, 0)}</td>
                          <td>{formatNumber(table.columns, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                ) : (
                  <EmptyState
                    icon={Database}
                    title="Source summary unavailable"
                    description="Check /api/data/summary."
                  />
                )}
              </Panel>

              <Panel
                title="Relationship validation"
                subtitle="Referential integrity checks reported by the backend"
              >
                {relationshipReport.length > 0 ? (
                  <DataTable>
                    <thead>
                      <tr>
                        <th>Relationship</th>
                        <th>Source records</th>
                        <th>Missing keys</th>
                        <th>Unmatched keys</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relationshipReport.map((item, index) => (
                        <tr key={`${item.relationship}-${index}`}>
                          <td className="relationship-name">{item.relationship}</td>
                          <td>{formatNumber(item.source_records, 0)}</td>
                          <td>{formatNumber(item.missing_foreign_keys, 0)}</td>
                          <td>{formatNumber(item.unmatched_foreign_keys, 0)}</td>
                          <td><StatusPill status={item.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                ) : (
                  <EmptyState
                    icon={Database}
                    title="Relationship response unavailable"
                    description="Check /api/data/relationships."
                  />
                )}
              </Panel>

              <Panel
                title="Validation interpretation"
                subtitle="Important context for responsible use"
              >
                <div className="interpretation-list">
                  <div>
                    <CheckCircle2 size={19} />
                    <p>
                      <strong>Referential integrity:</strong> the four reported
                      foreign-key relationships currently pass their checks.
                    </p>
                  </div>
                  <div>
                    <AlertTriangle size={19} />
                    <p>
                      <strong>Missing documentation:</strong> the sample reports
                      291 missing cells in appointment notes. Missing notes
                      should be interpreted in context, not automatically treated
                      as a care failure.
                    </p>
                  </div>
                  <div>
                    <ShieldCheck size={19} />
                    <p>
                      <strong>Human review:</strong> recorded no-shows and lab
                      requests without linked results are review candidates, not
                      proof of harm or a confirmed clinical gap.
                    </p>
                  </div>
                </div>
              </Panel>
            </div>
          </>
        )}

        <footer className="app-footer">
          <span>CareLens · Value-Based Care Analytics</span>
          <span>
            Decision support for review — not a diagnostic or treatment tool.
          </span>
        </footer>
      </main>
    </div>
  );
}