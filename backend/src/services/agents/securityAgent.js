const { getRetriever } = require('../rag/retriever');
const { getGeminiService } = require('../geminiService');

const DEFAULT_TOP_K = 5;
const DEFAULT_COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'devmind-pr-reviews';

const SECURITY_CATEGORIES = {
  authentication: 'authentication',
  authorization: 'authorization',
  sqlInjection: 'sql-injection',
  xss: 'xss',
  secrets: 'secrets',
};

const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

class SecurityAgentError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'SecurityAgentError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeDiffInput = (pullRequestDiff) => {
  if (typeof pullRequestDiff !== 'string') {
    throw new SecurityAgentError('pullRequestDiff must be a string.', 400);
  }

  const normalized = pullRequestDiff.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    throw new SecurityAgentError('pullRequestDiff must not be empty.', 400);
  }

  return normalized;
};

const normalizeCollectionName = (collectionName) => {
  const value = (collectionName || DEFAULT_COLLECTION_NAME).trim();

  if (!value) {
    throw new SecurityAgentError('collectionName must not be empty.', 400);
  }

  return value;
};

const normalizeTopK = (topK) => {
  const parsed = Number(topK);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOP_K;
};

const splitDiffLines = (diffText) => {
  return diffText.split('\n');
};

const parseDiffFiles = (diffText) => {
  const files = [];
  const lines = splitDiffLines(diffText);
  let current = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const filePath = match ? match[2] : null;

      current = {
        filePath,
        hunks: [],
        lines: [],
      };

      files.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(line);

    if (line.startsWith('@@ ')) {
      const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

      current.hunks.push({
        header: line,
        oldStart: hunkMatch ? Number(hunkMatch[1]) : null,
        oldCount: hunkMatch ? Number(hunkMatch[2] || 1) : null,
        newStart: hunkMatch ? Number(hunkMatch[3]) : null,
        newCount: hunkMatch ? Number(hunkMatch[4] || 1) : null,
      });
    }
  }

  return files.map((file) => ({
    filePath: file.filePath,
    hunkCount: file.hunks.length,
    diffText: ['diff --git a/' + file.filePath + ' b/' + file.filePath, ...file.lines].join('\n'),
  }));
};

const extractEvidenceSnippet = (diffText, pattern, maxLines = 6) => {
  const lines = splitDiffLines(diffText);
  const index = lines.findIndex((line) => pattern.test(line));

  if (index === -1) {
    return null;
  }

  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length, index + maxLines);

  return lines.slice(start, end).join('\n');
};

const inferFilePath = (chunk) => {
  return chunk?.metadata?.filePath || chunk?.filePath || chunk?.metadata?.path || null;
};

const buildFinding = ({
  category,
  severity,
  title,
  description,
  evidence,
  filePath,
  lineStart = null,
  lineEnd = null,
  confidence = 0.5,
  recommendation,
  context = {},
}) => ({
  category,
  severity,
  title,
  description,
  evidence,
  filePath,
  lineStart,
  lineEnd,
  confidence,
  recommendation,
  context,
});

const detectSecrets = (diffText, chunks) => {
  const findings = [];
  const secretPattern = /(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret|access[_-]?key)\s*[:=]/i;
  const envUsagePattern = /process\.env\.[A-Z0-9_]+/;

  const evidence = extractEvidenceSnippet(diffText, secretPattern) || extractEvidenceSnippet(diffText, envUsagePattern);

  if (evidence) {
    findings.push(
      buildFinding({
        category: SECURITY_CATEGORIES.secrets,
        severity: 'critical',
        title: 'Potential secret exposure in code changes',
        description:
          'The diff contains values or patterns that may expose secrets, credentials, or sensitive environment data.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: 0.92,
        recommendation:
          'Move secrets to environment variables or a secret manager, rotate any exposed credentials, and remove them from the diff.',
      }),
    );
  }

  return findings;
};

const detectAuthenticationIssues = (diffText, chunks) => {
  const findings = [];
  const weakAuthPattern = /(?:bcrypt|argon2|jwt|session|passport|auth)/i;
  const bypassPattern = /(?:skip[_-]?auth|disable[_-]?auth|bypass[_-]?auth|isAuthenticated\s*=\s*true)/i;
  const hardcodedPattern = /(?:password|token|secret|key)\s*[:=]\s*['"][^'"]+['"]/i;

  const evidence =
    extractEvidenceSnippet(diffText, bypassPattern) ||
    extractEvidenceSnippet(diffText, hardcodedPattern) ||
    extractEvidenceSnippet(diffText, weakAuthPattern);

  if (evidence && (bypassPattern.test(evidence) || hardcodedPattern.test(evidence))) {
    findings.push(
      buildFinding({
        category: SECURITY_CATEGORIES.authentication,
        severity: 'high',
        title: 'Authentication logic may be bypassed or hard-coded',
        description:
          'The changed code appears to weaken authentication controls or hard-code auth-related values.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: 0.84,
        recommendation:
          'Require server-verified authentication flows, remove hard-coded credentials, and validate all auth checks on the backend.',
      }),
    );
  }

  return findings;
};

const detectAuthorizationIssues = (diffText, chunks) => {
  const findings = [];
  const adminPattern = /(?:isAdmin|role\s*===\s*['"]admin['"]|hasPermission|canAccess|authorize|permission)/i;
  const bypassPattern = /(?:skip[_-]?permission|bypass[_-]?permission|allowAll|return\s+true\s*;\s*\/\/\s*TODO\s*auth)/i;

  const evidence =
    extractEvidenceSnippet(diffText, bypassPattern) || extractEvidenceSnippet(diffText, adminPattern);

  if (evidence && (bypassPattern.test(evidence) || /role\s*===\s*['"]admin['"]/i.test(evidence))) {
    findings.push(
      buildFinding({
        category: SECURITY_CATEGORIES.authorization,
        severity: 'high',
        title: 'Authorization checks may be incomplete or bypassed',
        description:
          'The diff suggests access-control logic may be missing, weakened, or bypassed for privileged actions.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: 0.81,
        recommendation:
          'Enforce server-side authorization for every privileged action and validate the caller role/claims before execution.',
      }),
    );
  }

  return findings;
};

const detectSqlInjectionIssues = (diffText, chunks) => {
  const findings = [];
  const unsafeSqlPattern = /(?:query|execute|exec|raw|sql)\s*\(?.*(?:\+|`\$\{).*\)/i;
  const interpolationPattern = /(?:SELECT|INSERT|UPDATE|DELETE).*(?:\+|`\$\{)/i;
  const parameterizedPattern = /(?:\?|\$\d+|:@|named\s*parameters|sequelize|knex|prisma|typeorm)/i;

  const evidence =
    extractEvidenceSnippet(diffText, unsafeSqlPattern) ||
    extractEvidenceSnippet(diffText, interpolationPattern);

  if (evidence && !parameterizedPattern.test(evidence)) {
    findings.push(
      buildFinding({
        category: SECURITY_CATEGORIES.sqlInjection,
        severity: 'critical',
        title: 'Potential SQL injection risk detected',
        description:
          'The changed code appears to build SQL statements using string concatenation or template interpolation.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: 0.88,
        recommendation:
          'Use parameterized queries or ORM bindings and avoid concatenating untrusted input into SQL strings.',
      }),
    );
  }

  return findings;
};

const detectXssIssues = (diffText, chunks) => {
  const findings = [];
  const unsafeRenderPattern = /(?:innerHTML|dangerouslySetInnerHTML|document\.write|insertAdjacentHTML)/i;
  const unsafeTemplatePattern = /(?:res\.send|res\.html|render)\(.*(?:\+|`\$\{)/i;
  const escapingPattern = /(?:escapeHtml|sanitize|DOMPurify|textContent|encodeURIComponent)/i;

  const evidence =
    extractEvidenceSnippet(diffText, unsafeRenderPattern) ||
    extractEvidenceSnippet(diffText, unsafeTemplatePattern);

  if (evidence && !escapingPattern.test(evidence)) {
    findings.push(
      buildFinding({
        category: SECURITY_CATEGORIES.xss,
        severity: 'high',
        title: 'Potential XSS sink introduced',
        description:
          'The diff appears to introduce unsafe HTML rendering or DOM insertion without visible sanitization.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: 0.86,
        recommendation:
          'Prefer safe text rendering, sanitize untrusted content, and avoid injecting raw HTML unless it is strictly controlled.',
      }),
    );
  }

  return findings;
};

const normalizeFindings = (findings) => {
  return findings
    .filter(Boolean)
    .sort((left, right) => {
      const severityDelta = (SEVERITY_ORDER[left.severity] ?? 99) - (SEVERITY_ORDER[right.severity] ?? 99);
      if (severityDelta !== 0) {
        return severityDelta;
      }

      return (right.confidence || 0) - (left.confidence || 0);
    });
};

const summarizeFindings = (findings) => {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory = {
    [SECURITY_CATEGORIES.authentication]: 0,
    [SECURITY_CATEGORIES.authorization]: 0,
    [SECURITY_CATEGORIES.sqlInjection]: 0,
    [SECURITY_CATEGORIES.xss]: 0,
    [SECURITY_CATEGORIES.secrets]: 0,
  };

  for (const finding of findings) {
    if (bySeverity[finding.severity] !== undefined) {
      bySeverity[finding.severity] += 1;
    }

    if (byCategory[finding.category] !== undefined) {
      byCategory[finding.category] += 1;
    }
  }

  return { bySeverity, byCategory, total: findings.length };
};

const repairJSON = (str) => {
  // 1. Fix unescaped newlines inside strings
  let inString = false;
  let escaped = false;
  let repaired = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && !escaped) {
      inString = !inString;
      repaired += char;
    } else if (inString && (char === '\n' || char === '\r')) {
      repaired += '\\n';
    } else {
      repaired += char;
    }
    escaped = (char === '\\' && !escaped);
  }

  // 2. Fix trailing commas in arrays and objects
  repaired = repaired.replace(/,(\s*[\]}])/g, '$1');

  // 3. Remove control characters (0-31) except tab, newline, and carriage return
  repaired = repaired.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  return repaired;
};

const parseJSONResponse = (text) => {
  if (typeof text !== 'string') {
    console.error('Failed to parse agent JSON response. Raw text is not a string:', text);
    return {
      findings: [],
      summary: 'Unable to parse Gemini response.'
    };
  }

  let cleanText = text.trim();

  // Strip markdown code fences if present
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
  }

  // Extract the first valid JSON object enclosed in { ... }
  const startIdx = cleanText.indexOf('{');
  const endIdx = cleanText.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    cleanText = cleanText.substring(startIdx, endIdx + 1);
  }

  // Try direct parsing first
  try {
    return JSON.parse(cleanText);
  } catch (firstError) {
    // Attempt repair step
    try {
      const repairedText = repairJSON(cleanText);
      return JSON.parse(repairedText);
    } catch (repairError) {
      // Log the raw Gemini response when parsing fails
      console.error('Failed to parse agent JSON response. Raw text:', text);
      console.error('Parsing error after repair attempt:', repairError);

      return {
        findings: [],
        summary: 'Unable to parse Gemini response.'
      };
    }
  }
};

const enrichFindingLocally = (finding, diffText) => {
  const titleLower = (finding.title || '').toLowerCase();
  
  let category = 'secrets';
  if (titleLower.includes('sql') || titleLower.includes('injection') || titleLower.includes('query')) {
    category = 'sql-injection';
  } else if (titleLower.includes('xss') || titleLower.includes('html') || titleLower.includes('cross-site') || titleLower.includes('sanitize') || titleLower.includes('dangerously')) {
    category = 'xss';
  } else if (titleLower.includes('secret') || titleLower.includes('key') || titleLower.includes('token') || titleLower.includes('password') || titleLower.includes('credential') || titleLower.includes('private')) {
    category = 'secrets';
  } else if (titleLower.includes('authorization') || titleLower.includes('permission') || titleLower.includes('role') || titleLower.includes('access control') || titleLower.includes('privilege') || titleLower.includes('rbac')) {
    category = 'authorization';
  } else if (titleLower.includes('auth') || titleLower.includes('login') || titleLower.includes('jwt') || titleLower.includes('session') || titleLower.includes('bcrypt')) {
    category = 'authentication';
  }

  let description = '';
  let recommendation = '';
  let confidence = 0.5;

  switch (category) {
    case 'secrets':
      description = 'The diff contains values or patterns that may expose secrets, credentials, or sensitive environment data.';
      recommendation = 'Move secrets to environment variables or a secret manager, rotate any exposed credentials, and remove them from the diff.';
      confidence = 0.92;
      break;
    case 'authentication':
      description = 'The changed code appears to weaken authentication controls or hard-code auth-related values.';
      recommendation = 'Require server-verified authentication flows, remove hard-coded credentials, and validate all auth checks on the backend.';
      confidence = 0.84;
      break;
    case 'authorization':
      description = 'The diff suggests access-control logic may be missing, weakened, or bypassed for privileged actions.';
      recommendation = 'Enforce server-side authorization for every privileged action and validate the caller role/claims before execution.';
      confidence = 0.81;
      break;
    case 'sql-injection':
      description = 'The changed code appears to build SQL statements using string concatenation or template interpolation.';
      recommendation = 'Use parameterized queries or ORM bindings and avoid concatenating untrusted input into SQL strings.';
      confidence = 0.88;
      break;
    case 'xss':
      description = 'The diff appears to introduce unsafe HTML rendering or DOM insertion without visible sanitization.';
      recommendation = 'Prefer safe text rendering, sanitize untrusted content, and avoid injecting raw HTML unless it is strictly controlled.';
      confidence = 0.86;
      break;
  }

  let evidence = null;
  const lines = diffText.split('\n');
  let keyword = '';
  if (category === 'secrets') keyword = 'secret|key|token|password|process\\.env';
  else if (category === 'sql-injection') keyword = 'select|insert|update|delete|query|exec';
  else if (category === 'xss') keyword = 'innerHTML|dangerously|render|res\\.send';
  else if (category === 'authentication') keyword = 'login|auth|session|jwt';
  else if (category === 'authorization') keyword = 'admin|role|permission|allow';

  if (keyword) {
    const rx = new RegExp(keyword, 'i');
    const idx = lines.findIndex(line => rx.test(line));
    if (idx !== -1) {
      const start = Math.max(0, idx - 1);
      const end = Math.min(lines.length, idx + 6);
      evidence = lines.slice(start, end).join('\n');
    }
  }

  if (!evidence && lines.length > 0) {
    evidence = lines.slice(0, Math.min(lines.length, 6)).join('\n');
  }

  return {
    category,
    severity: finding.severity || 'medium',
    title: finding.title || 'Security finding',
    description,
    evidence,
    filePath: finding.filePath || null,
    lineStart: finding.lineStart || null,
    lineEnd: finding.lineEnd || null,
    confidence,
    recommendation,
    context: finding.context || {},
  };
};

const createSecurityAgent = ({ retriever = getRetriever(), geminiService = getGeminiService() } = {}) => {
  const review = async ({
    pullRequestDiff,
    collectionName = DEFAULT_COLLECTION_NAME,
    topK = DEFAULT_TOP_K,
  }) => {
    const diffText = normalizeDiffInput(pullRequestDiff);
    const normalizedCollectionName = normalizeCollectionName(collectionName);
    const normalizedTopK = normalizeTopK(topK);

    const repositoryContext = await retriever.retrieveRelevantCodeChunks({
      pullRequestDiff: diffText,
      collectionName: normalizedCollectionName,
      topK: normalizedTopK,
    });

    const contextChunks = Array.isArray(repositoryContext?.context)
      ? repositoryContext.context
      : Array.isArray(repositoryContext?.chunks)
        ? repositoryContext.chunks
        : [];

    const contextText = contextChunks
      .map((c, i) => `Context Chunk #${i + 1} (File: ${c.filePath}):\n${c.document}`)
      .join('\n\n');

    const prompt = `Code changes (Git diff):\n\`\`\`diff\n${diffText}\n\`\`\`\n\nCodebase Context:\n${contextText || 'No context chunks retrieved.'}`;

    const systemPrompt = `You are a Senior Security Engineer and code auditor.
Analyze the provided Git diff (code changes) and codebase context for security issues.
Categorize any security vulnerabilities under the following categories (use these to write the title):
- authentication (broken authentication, weak login mechanisms, hardcoded tokens)
- authorization (broken access controls, privilege escalation)
- sql-injection (unsafe database queries, string concatenation in SQL statements)
- xss (cross-site scripting, unsafe rendering of untrusted content)
- secrets (exposed passwords, API keys, private keys, sensitive configuration values)

Assign one of the following severity levels to each issue:
- critical
- high
- medium
- low
- info

Format your response STRICTLY as a JSON object with the following schema:
{
  "findings": [
    {
      "severity": "one of the severities above",
      "title": "a short, descriptive title",
      "filePath": "the file path where the issue is found"
    }
  ]
}

If no security issues are found, return: {"findings": []}
Return at most 2 findings. Return only the highest severity findings.
Return ONLY valid JSON. Do not include markdown, explanations, comments, or code fences.
Return compact minified JSON.
Do not pretty print JSON.
Do not include whitespace or line breaks unless required inside string values.`;

    const diffChars = diffText.length;
    const diffTokens = Math.ceil(diffChars / 4);
    const contextCount = contextChunks.length;
    const contextChars = contextChunks.reduce((acc, c) => acc + (c.document || '').length, 0);
    const contextTokens = Math.ceil(contextChars / 4);
    const promptChars = prompt.length;
    const promptTokens = Math.ceil(promptChars / 4);

    console.log(`[AGENT TOKEN AUDIT]`);
    console.log(`Diff chars: ${diffChars}`);
    console.log(`Diff tokens: ${diffTokens}`);
    console.log(`Context chunks: ${contextCount}`);
    console.log(`Context chars: ${contextChars}`);
    console.log(`Context tokens: ${contextTokens}`);
    console.log(`Prompt chars: ${promptChars}`);
    console.log(`Prompt tokens: ${promptTokens}`);

    let findings = [];
    let summary = null;
    try {
      const response = await geminiService.generateReview({
        prompt,
        systemPrompt,
        temperature: 0.1,
        maxOutputTokens: 300,
      });

      const parsed = parseJSONResponse(response.text);
      const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
      findings = rawFindings.map((f) => enrichFindingLocally(f, diffText));
      if (parsed.summary) {
        summary = parsed.summary;
      }
    } catch (err) {
      console.error('[SecurityAgent] Error during Gemini code review:', err);
    }

    const normalizedFindings = normalizeFindings(findings);

    return {
      agent: 'security',
      collectionName: normalizedCollectionName,
      topK: normalizedTopK,
      repositoryContext,
      findings: normalizedFindings,
      summary: summary || summarizeFindings(normalizedFindings),
    };
  };

  return {
    review,
  };
};

let cachedSecurityAgent = null;

const getSecurityAgent = () => {
  if (!cachedSecurityAgent) {
    cachedSecurityAgent = createSecurityAgent();
  }

  return cachedSecurityAgent;
};

module.exports = {
  SecurityAgentError,
  SECURITY_CATEGORIES,
  createSecurityAgent,
  getSecurityAgent,
  reviewSecurity: async (options) => getSecurityAgent().review(options),
};