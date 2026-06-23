const SEVERITY_LEVELS = {
  critical: {
    key: 'critical',
    label: 'Critical',
    weight: 0,
    description: 'Requires immediate attention and should block merge until resolved.',
  },
  high: {
    key: 'high',
    label: 'High',
    weight: 1,
    description: 'Important issue that should be fixed before release.',
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    weight: 2,
    description: 'Moderate issue that should be addressed in the near term.',
  },
  low: {
    key: 'low',
    label: 'Low',
    weight: 3,
    description: 'Minor issue or suggestion for improvement.',
  },
};

const DEFAULT_SEVERITY = SEVERITY_LEVELS.low;

const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

class SeverityServiceError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'SeverityServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeSeverity = (severity) => {
  if (typeof severity !== 'string') {
    return DEFAULT_SEVERITY.key;
  }

  const normalized = severity.trim().toLowerCase();

  if (SEVERITY_LEVELS[normalized]) {
    return normalized;
  }

  return DEFAULT_SEVERITY.key;
};

const normalizeFinding = (finding, index) => {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    throw new SeverityServiceError(`findings[${index}] must be an object.`, 400);
  }

  return {
    ...finding,
    severity: normalizeSeverity(finding.severity),
  };
};

const getSeverityMetadata = () => {
  return {
    levels: Object.values(SEVERITY_LEVELS).map((level) => ({
      ...level,
    })),
    defaultSeverity: DEFAULT_SEVERITY.key,
    severityOrder: { ...SEVERITY_ORDER },
  };
};

const compareSeverity = (left, right) => {
  const leftOrder = SEVERITY_ORDER[normalizeSeverity(left)] ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = SEVERITY_ORDER[normalizeSeverity(right)] ?? Number.MAX_SAFE_INTEGER;

  return leftOrder - rightOrder;
};

const bucketFindingsBySeverity = (findings) => {
  if (!Array.isArray(findings)) {
    throw new SeverityServiceError('findings must be an array.', 400);
  }

  const normalizedFindings = findings.map(normalizeFinding);

  const buckets = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  for (const finding of normalizedFindings) {
    buckets[finding.severity].push(finding);
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((left, right) => {
      const leftConfidence = Number(left.confidence || 0);
      const rightConfidence = Number(right.confidence || 0);

      if (rightConfidence !== leftConfidence) {
        return rightConfidence - leftConfidence;
      }

      return String(left.title || '').localeCompare(String(right.title || ''));
    });
  }

  return buckets;
};

const summarizeSeverity = (findings) => {
  const buckets = bucketFindingsBySeverity(findings);
  const total = findings.length;

  const counts = {
    critical: buckets.critical.length,
    high: buckets.high.length,
    medium: buckets.medium.length,
    low: buckets.low.length,
  };

  const totalScore =
    (counts.critical * 4) +
    (counts.high * 3) +
    (counts.medium * 2) +
    (counts.low * 1);

  const severitySummary = Object.entries(SEVERITY_LEVELS).map(([key, metadata]) => ({
    ...metadata,
    count: counts[key],
    percentage: total > 0 ? Number(((counts[key] / total) * 100).toFixed(2)) : 0,
    findings: buckets[key],
  }));

  const overallSeverity = ['critical', 'high', 'medium', 'low'].find((key) => counts[key] > 0) || 'low';

  return {
    total,
    counts,
    totalScore,
    overallSeverity,
    overallSeverityLabel: SEVERITY_LEVELS[overallSeverity].label,
    metadata: getSeverityMetadata(),
    buckets,
    severitySummary,
  };
};

const createSeverityService = () => {
  const categorizeFindings = (findings) => {
    const summary = summarizeSeverity(Array.isArray(findings) ? findings : []);

    return {
      critical: summary.buckets.critical,
      high: summary.buckets.high,
      medium: summary.buckets.medium,
      low: summary.buckets.low,
      metadata: summary.metadata,
      summary: {
        total: summary.total,
        counts: summary.counts,
        totalScore: summary.totalScore,
        overallSeverity: summary.overallSeverity,
        overallSeverityLabel: summary.overallSeverityLabel,
        severitySummary: summary.severitySummary,
      },
    };
  };

  return {
    getSeverityMetadata,
    bucketFindingsBySeverity,
    summarizeSeverity,
    categorizeFindings,
  };
};

let cachedSeverityService = null;

const getSeverityService = () => {
  if (!cachedSeverityService) {
    cachedSeverityService = createSeverityService();
  }

  return cachedSeverityService;
};

module.exports = {
  SeverityServiceError,
  SEVERITY_LEVELS,
  createSeverityService,
  getSeverityService,
  getSeverityMetadata: () => getSeverityService().getSeverityMetadata(),
  bucketFindingsBySeverity: (findings) => getSeverityService().bucketFindingsBySeverity(findings),
  summarizeSeverity: (findings) => getSeverityService().summarizeSeverity(findings),
  categorizeFindings: (findings) => getSeverityService().categorizeFindings(findings),
  compareSeverity,
};