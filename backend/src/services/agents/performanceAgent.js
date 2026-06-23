const { getRetriever } = require('../rag/retriever');
const { getGeminiService } = require('../geminiService');

const DEFAULT_TOP_K = 5;
const DEFAULT_COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'devmind-pr-reviews';

const PERFORMANCE_CATEGORIES = {
  expensiveLoops: 'expensive-loops',
  inefficientOperations: 'inefficient-operations',
  repeatedQueries: 'repeated-queries',
};

const SEVERITY_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

class PerformanceAgentError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'PerformanceAgentError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeDiffInput = (pullRequestDiff) => {
  if (typeof pullRequestDiff !== 'string') {
    throw new PerformanceAgentError('pullRequestDiff must be a string.', 400);
  }

  const normalized = pullRequestDiff.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    throw new PerformanceAgentError('pullRequestDiff must not be empty.', 400);
  }

  return normalized;
};

const normalizeCollectionName = (collectionName) => {
  const value = (collectionName || DEFAULT_COLLECTION_NAME).trim();

  if (!value) {
    throw new PerformanceAgentError('collectionName must not be empty.', 400);
  }

  return value;
};

const normalizeTopK = (topK) => {
  const parsed = Number(topK);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOP_K;
};

const splitDiffLines = (diffText) => diffText.split('\n');

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

const extractEvidenceSnippet = (diffText, pattern, maxLines = 8) => {
  const lines = splitDiffLines(diffText);
  const index = lines.findIndex((line) => pattern.test(line));

  if (index === -1) {
    return null;
  }

  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length, index + maxLines);

  return lines.slice(start, end).join('\n');
};

const collectFilePaths = (chunks = []) => {
  return chunks
    .map((chunk) => inferFilePath(chunk))
    .filter((filePath) => typeof filePath === 'string' && filePath.trim());
};

const detectExpensiveLoops = (diffText, chunks) => {
  const findings = [];
  const loopPattern = /\b(for|while|for\s*\()\b/i;
  const nestedLoopPattern = /(?:for|while)[\s\S]{0,180}(?:for|while)/i;
  const awaitInLoopPattern = /(?:for|while)[\s\S]{0,180}\bawait\b/i;
  const evidence =
    extractEvidenceSnippet(diffText, awaitInLoopPattern) ||
    extractEvidenceSnippet(diffText, nestedLoopPattern) ||
    extractEvidenceSnippet(diffText, loopPattern);

  if (evidence) {
    const severity = awaitInLoopPattern.test(evidence) || nestedLoopPattern.test(evidence) ? 'medium' : 'low';

    findings.push(
      buildFinding({
        category: PERFORMANCE_CATEGORIES.expensiveLoops,
        severity,
        title: 'Potentially expensive loop detected',
        description:
          'The diff introduces a loop that may scale poorly, especially if it nests other loops or performs awaited work per iteration.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: awaitInLoopPattern.test(evidence) ? 0.88 : 0.73,
        recommendation:
          'Prefer batching, indexing, memoization, or precomputing values outside the loop to reduce per-iteration work.',
        context: {
          hasNestedLoop: nestedLoopPattern.test(evidence),
          hasAwaitInLoop: awaitInLoopPattern.test(evidence),
        },
      }),
    );
  }

  return findings;
};

const detectInefficientOperations = (diffText, chunks) => {
  const findings = [];
  const repeatedSearchPattern = /(?:\.find\(|\.filter\(|\.some\(|\.includes\(|\.indexOf\(|\.sort\(|JSON\.(?:parse|stringify)|new RegExp\(|Object\.keys\(|Object\.values\(|Array\.from\()/i;
  const insideLoopPattern = /(?:for|while)[\s\S]{0,220}(?:\.find\(|\.filter\(|\.some\(|\.includes\(|\.indexOf\(|\.sort\(|JSON\.(?:parse|stringify)|new RegExp\()/i;
  const evidence =
    extractEvidenceSnippet(diffText, insideLoopPattern) ||
    extractEvidenceSnippet(diffText, repeatedSearchPattern);

  if (evidence) {
    findings.push(
      buildFinding({
        category: PERFORMANCE_CATEGORIES.inefficientOperations,
        severity: insideLoopPattern.test(evidence) ? 'medium' : 'low',
        title: 'Inefficient operation may increase runtime cost',
        description:
          'The diff introduces an operation that can be expensive when repeated or placed inside a hot path.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: insideLoopPattern.test(evidence) ? 0.84 : 0.69,
        recommendation:
          'Cache repeated lookups, move invariant work outside loops, and avoid repeated serialization or full-array scans on the hot path.',
        context: {
          repeatedScan: /\.find\(|\.filter\(|\.some\(|\.includes\(|\.indexOf\(/i.test(evidence),
          repeatedSerialization: /JSON\.(?:parse|stringify)/i.test(evidence),
        },
      }),
    );
  }

  return findings;
};

const detectRepeatedQueries = (diffText, chunks) => {
  const findings = [];
  const queryPattern = /\b(?:find|findOne|findMany|query|execute|exec|get|fetch|select|aggregate|count|list)\s*\(/i;
  const repeatedQueryPattern = /(?:await\s+)?(?:.+\.)?(?:find|findOne|findMany|query|execute|exec|get|fetch|select|aggregate|count|list)\s*\([^\)]*\)[\s\S]{0,120}(?:await\s+)?(?:.+\.)?(?:find|findOne|findMany|query|execute|exec|get|fetch|select|aggregate|count|list)\s*\(/i;
  const queryInsideLoopPattern = /(?:for|while)[\s\S]{0,240}\b(?:find|findOne|findMany|query|execute|exec|get|fetch|select|aggregate|count|list)\s*\(/i;
  const evidence =
    extractEvidenceSnippet(diffText, queryInsideLoopPattern) ||
    extractEvidenceSnippet(diffText, repeatedQueryPattern) ||
    extractEvidenceSnippet(diffText, queryPattern);

  if (evidence && (queryInsideLoopPattern.test(evidence) || repeatedQueryPattern.test(evidence))) {
    findings.push(
      buildFinding({
        category: PERFORMANCE_CATEGORIES.repeatedQueries,
        severity: 'high',
        title: 'Repeated query pattern may hurt performance',
        description:
          'The diff appears to add repeated database or network lookups that could be batched, cached, or moved outside a loop.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: queryInsideLoopPattern.test(evidence) ? 0.9 : 0.82,
        recommendation:
          'Batch related queries, memoize stable lookups, and avoid issuing the same query repeatedly inside iteration or request handling paths.',
        context: {
          repeatedQuery: repeatedQueryPattern.test(evidence),
          queryInLoop: queryInsideLoopPattern.test(evidence),
          fileCount: collectFilePaths(chunks).length,
        },
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
  const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  const byCategory = {
    [PERFORMANCE_CATEGORIES.expensiveLoops]: 0,
    [PERFORMANCE_CATEGORIES.inefficientOperations]: 0,
    [PERFORMANCE_CATEGORIES.repeatedQueries]: 0,
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

const createPerformanceAgent = ({ retriever = getRetriever(), geminiService = getGeminiService() } = {}) => {
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

    const systemPrompt = `You are a Senior Performance Engineer and code auditor.
Analyze the provided Git diff (code changes) and codebase context for performance issues.
Categorize any performance bottlenecks or inefficiencies under the following categories:
- expensive-loops (nested loops, O(N^2) complexity, await calls inside loops, or loop bodies doing heavy computation)
- inefficient-operations (expensive string/array manipulation, repeated parsing, regex in hot paths, unnecessary copies)
- repeated-queries (redundant database queries, N+1 queries, unbatched API calls)

Assign one of the following severity levels to each issue:
- high
- medium
- low
- info

Format your response STRICTLY as a JSON object with a single key "findings" which contains an array of finding objects.
Each finding object must have:
- category: one of the categories above (using exactly: expensive-loops, inefficient-operations, or repeated-queries)
- severity: one of the severities above (using exactly: high, medium, low, or info)
- title: a short, descriptive title
- description: detailed description of the performance issue
- evidence: the exact line or block of code from the diff that introduces the issue
- filePath: the file path where the issue is found (infer from the diff file header or the codebase context)
- lineStart: (integer or null) start line number in the new/modified file if you can determine it, else null
- lineEnd: (integer or null) end line number in the new/modified file if you can determine it, else null
- confidence: (float between 0.0 and 1.0) your confidence score in this finding
- recommendation: clear, actionable step to fix or optimize the performance issue

If no performance issues are found, return: {"findings": []}
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
      findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      if (parsed.summary) {
        summary = parsed.summary;
      }
    } catch (err) {
      console.error('[PerformanceAgent] Error during Gemini code review:', err);
    }

    const normalizedFindings = normalizeFindings(findings);

    return {
      agent: 'performance',
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

let cachedPerformanceAgent = null;

const getPerformanceAgent = () => {
  if (!cachedPerformanceAgent) {
    cachedPerformanceAgent = createPerformanceAgent();
  }

  return cachedPerformanceAgent;
};

module.exports = {
  PerformanceAgentError,
  PERFORMANCE_CATEGORIES,
  createPerformanceAgent,
  getPerformanceAgent,
  reviewPerformance: async (options) => getPerformanceAgent().review(options),
};