const DEFAULT_REPORT_TITLE = 'DevMind Consolidated Review Report';

const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

class AggregatorAgentError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'AggregatorAgentError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeReportInput = (report, label) => {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new AggregatorAgentError(`${label} must be an object.`, 400);
  }

  const findings = Array.isArray(report.findings) ? report.findings : [];

  return {
    ...report,
    findings,
  };
};

const normalizeCollectionName = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return value.trim();
};

const getSeverityCounts = () => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
});

const getCategoryCounts = (findings) => {
  const counts = new Map();

  for (const finding of findings) {
    const category = finding?.category || 'unknown';
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  return Object.fromEntries(counts.entries());
};

const compareFindings = (left, right) => {
  const leftSeverity = SEVERITY_ORDER[left?.severity] ?? 99;
  const rightSeverity = SEVERITY_ORDER[right?.severity] ?? 99;

  if (leftSeverity !== rightSeverity) {
    return leftSeverity - rightSeverity;
  }

  return (right?.confidence || 0) - (left?.confidence || 0);
};

const mergeFindings = (reports) => {
  const unique = new Map();

  for (const report of reports) {
    for (const finding of report.findings) {
      const fingerprint = [
        finding?.category || 'unknown',
        finding?.filePath || 'unknown-file',
        finding?.title || 'unknown-title',
        finding?.evidence || 'unknown-evidence',
      ].join('::');

      const existing = unique.get(fingerprint);

      if (!existing) {
        unique.set(fingerprint, {
          ...finding,
          sources: [report.agent],
          reports: [report.agent],
        });
        continue;
      }

      existing.sources = Array.from(new Set([...(existing.sources || []), report.agent]));
      existing.reports = Array.from(new Set([...(existing.reports || []), report.agent]));
      existing.confidence = Math.max(existing.confidence || 0, finding?.confidence || 0);
      existing.severity = compareFindings(existing, finding) <= 0 ? existing.severity : finding.severity;
    }
  }

  return Array.from(unique.values()).sort(compareFindings);
};

const summarizeFindings = (findings) => {
  const bySeverity = getSeverityCounts();
  const byCategory = getCategoryCounts(findings);

  for (const finding of findings) {
    if (finding?.severity && bySeverity[finding.severity] !== undefined) {
      bySeverity[finding.severity] += 1;
    }
  }

  return {
    total: findings.length,
    bySeverity,
    byCategory,
  };
};

const getOverallSeverity = (findings) => {
  if (!Array.isArray(findings) || findings.length === 0) {
    return 'info';
  }

  const sorted = [...findings].sort(compareFindings);
  return sorted[0]?.severity || 'info';
};

const createAgentSnapshot = (report) => ({
  agent: report.agent,
  collectionName: normalizeCollectionName(report.collectionName),
  topK: report.topK ?? null,
  summary: report.summary || { total: Array.isArray(report.findings) ? report.findings.length : 0 },
  findings: Array.isArray(report.findings) ? report.findings : [],
  repositoryContext: report.repositoryContext || null,
});

const createAggregatorAgent = () => {
  const aggregate = async ({ security, performance, quality, title = DEFAULT_REPORT_TITLE }) => {
    const normalizedSecurity = normalizeReportInput(security, 'security');
    const normalizedPerformance = normalizeReportInput(performance, 'performance');
    const normalizedQuality = normalizeReportInput(quality, 'quality');

    const agentReports = [
      createAgentSnapshot(normalizedSecurity),
      createAgentSnapshot(normalizedPerformance),
      createAgentSnapshot(normalizedQuality),
    ];

    const consolidatedFindings = mergeFindings(agentReports);

    return {
      title,
      generatedAt: new Date().toISOString(),
      agentReports,
      findings: consolidatedFindings,
      summary: {
        total: consolidatedFindings.length,
        overallSeverity: getOverallSeverity(consolidatedFindings),
        bySeverity: summarizeFindings(consolidatedFindings).bySeverity,
        byCategory: summarizeFindings(consolidatedFindings).byCategory,
        sources: agentReports.map((report) => report.agent),
      },
    };
  };

  return {
    aggregate,
  };
};

let cachedAggregatorAgent = null;

const getAggregatorAgent = () => {
  if (!cachedAggregatorAgent) {
    cachedAggregatorAgent = createAggregatorAgent();
  }

  return cachedAggregatorAgent;
};

module.exports = {
  AggregatorAgentError,
  createAggregatorAgent,
  getAggregatorAgent,
  aggregateReports: async (options) => getAggregatorAgent().aggregate(options),
};