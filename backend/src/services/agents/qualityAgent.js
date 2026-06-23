const { getRetriever } = require('../rag/retriever');
const { getGeminiService } = require('../geminiService');

const DEFAULT_TOP_K = 5;
const DEFAULT_COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'devmind-pr-reviews';

const QUALITY_CATEGORIES = {
  naming: 'naming',
  readability: 'readability',
  maintainability: 'maintainability',
  errorHandling: 'error-handling',
};

const SEVERITY_ORDER = {
  medium: 0,
  low: 1,
  info: 2,
};

class QualityAgentError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'QualityAgentError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeDiffInput = (pullRequestDiff) => {
  if (typeof pullRequestDiff !== 'string') {
    throw new QualityAgentError('pullRequestDiff must be a string.', 400);
  }

  const normalized = pullRequestDiff.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    throw new QualityAgentError('pullRequestDiff must not be empty.', 400);
  }

  return normalized;
};

const normalizeCollectionName = (collectionName) => {
  const value = (collectionName || DEFAULT_COLLECTION_NAME).trim();

  if (!value) {
    throw new QualityAgentError('collectionName must not be empty.', 400);
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

const detectNamingIssues = (diffText, chunks) => {
  const findings = [];
  const badNamePattern = /(?:let|const|var|function|class|enum)\s+([a-z]{1,2}|temp|data|value|item|obj|res|err|x|y|z)\b/i;
  const camelCasePattern = /(?:let|const|var|function|class)\s+([a-z]+(?:_[a-z]+)+)\b/i;
  const evidence = extractEvidenceSnippet(diffText, badNamePattern) || extractEvidenceSnippet(diffText, camelCasePattern);

  if (evidence) {
    findings.push(
      buildFinding({
        category: QUALITY_CATEGORIES.naming,
        severity: 'low',
        title: 'Naming may be too vague or inconsistent',
        description:
          'The diff introduces identifiers that appear short, generic, or inconsistent with common naming conventions.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: 0.7,
        recommendation:
          'Use descriptive identifiers that communicate intent and prefer consistent casing and terminology across the codebase.',
        context: {
          hasSnakeCase: camelCasePattern.test(evidence),
        },
      }),
    );
  }

  return findings;
};

const detectReadabilityIssues = (diffText, chunks) => {
  const findings = [];
  const longLinePattern = /^.{121,}$/m;
  const nestedConditionPattern = /(?:if|else if|switch|try|catch)[\s\S]{0,260}(?:if|else if|switch|try|catch)[\s\S]{0,260}(?:if|else if|switch|try|catch)/i;
  const oneLinerFunctionPattern = /(?:function\s+\w+\s*\(|=>\s*\{?)[\s\S]{0,120}[;{}]/i;
  const evidence =
    extractEvidenceSnippet(diffText, longLinePattern) ||
    extractEvidenceSnippet(diffText, nestedConditionPattern) ||
    extractEvidenceSnippet(diffText, oneLinerFunctionPattern);

  if (evidence) {
    findings.push(
      buildFinding({
        category: QUALITY_CATEGORIES.readability,
        severity: 'low',
        title: 'Readability could be improved',
        description:
          'The diff contains long lines, dense branching, or compressed logic that may be harder to scan and maintain.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: longLinePattern.test(evidence) ? 0.78 : 0.66,
        recommendation:
          'Break long statements into smaller steps, simplify branching, and use whitespace or helper functions to improve scanability.',
        context: {
          hasLongLine: longLinePattern.test(evidence),
          hasNestedCondition: nestedConditionPattern.test(evidence),
        },
      }),
    );
  }

  return findings;
};

const detectMaintainabilityIssues = (diffText, chunks) => {
  const findings = [];
  const duplicationPattern = /(?:const|let|var)\s+\w+\s*=\s*.+\n[\s\S]{0,180}(?:const|let|var)\s+\w+\s*=\s*.+/i;
  const magicNumberPattern = /[^\w](?:0x[0-9a-f]+|\d{2,})(?![\w.])/i;
  const excessiveResponsibilityPattern = /(?:function|class|const\s+\w+\s*=\s*\([^)]*\)\s*=>)[\s\S]{0,360}(?:return|await|try|catch)[\s\S]{0,240}(?:return|await|try|catch)/i;
  const evidence =
    extractEvidenceSnippet(diffText, duplicationPattern) ||
    extractEvidenceSnippet(diffText, excessiveResponsibilityPattern) ||
    extractEvidenceSnippet(diffText, magicNumberPattern);

  if (evidence) {
    findings.push(
      buildFinding({
        category: QUALITY_CATEGORIES.maintainability,
        severity: 'medium',
        title: 'Maintainability risk detected',
        description:
          'The diff suggests duplicated logic, magic values, or code that may be doing too much in one place.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: duplicationPattern.test(evidence) ? 0.81 : 0.68,
        recommendation:
          'Extract shared logic, replace magic values with named constants, and consider splitting large responsibilities into smaller units.',
        context: {
          hasDuplication: duplicationPattern.test(evidence),
          hasMagicNumber: magicNumberPattern.test(evidence),
        },
      }),
    );
  }

  return findings;
};

const detectErrorHandlingIssues = (diffText, chunks) => {
  const findings = [];
  const missingCatchPattern = /(?:try\s*\{[\s\S]{0,180}\})(?![\s\S]{0,120}catch)/i;
  const swallowErrorPattern = /catch\s*\(.*\)\s*\{[\s\S]{0,120}(?:return\s+null|return\s+false|\/\/\s*ignore|console\.(?:log|warn)\()/i;
  const genericErrorPattern = /throw\s+new\s+Error\s*\(\s*['"][^'"]*['"]\s*\)/i;
  const evidence =
    extractEvidenceSnippet(diffText, swallowErrorPattern) ||
    extractEvidenceSnippet(diffText, genericErrorPattern) ||
    extractEvidenceSnippet(diffText, missingCatchPattern);

  if (evidence) {
    findings.push(
      buildFinding({
        category: QUALITY_CATEGORIES.errorHandling,
        severity: 'medium',
        title: 'Error handling may be incomplete',
        description:
          'The diff appears to swallow errors, throw generic errors, or use try blocks without clear recovery or context.',
        evidence,
        filePath: inferFilePath(chunks[0]) || null,
        confidence: swallowErrorPattern.test(evidence) ? 0.84 : 0.7,
        recommendation:
          'Preserve the original error context, handle failures intentionally, and avoid silent catches that hide operational problems.',
        context: {
          swallowsError: swallowErrorPattern.test(evidence),
          throwsGenericError: genericErrorPattern.test(evidence),
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
  const bySeverity = { medium: 0, low: 0, info: 0 };
  const byCategory = {
    [QUALITY_CATEGORIES.naming]: 0,
    [QUALITY_CATEGORIES.readability]: 0,
    [QUALITY_CATEGORIES.maintainability]: 0,
    [QUALITY_CATEGORIES.errorHandling]: 0,
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

const createQualityAgent = ({ retriever = getRetriever(), geminiService = getGeminiService() } = {}) => {
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

    const systemPrompt = `You are a Senior Software Engineer, Tech Lead, and code quality reviewer.
Analyze the provided Git diff (code changes) and codebase context for software design, style, and code quality issues.
Categorize any concerns under the following categories:
- naming (unclear or generic variable/function/class names, casing inconsistencies, poor terminology)
- readability (complex expressions, nested conditionals, excessive function/line length, lack of spacing or comments)
- maintainability (duplicated logic, code smell, violation of SOLID principles, tight coupling, magic numbers/strings)
- error-handling (swallowed exceptions, generic throws, missing try/catch blocks, lack of clean recovery)

Assign one of the following severity levels to each issue:
- medium
- low
- info

Format your response STRICTLY as a JSON object with a single key "findings" which contains an array of finding objects.
Each finding object must have:
- category: one of the categories above (using exactly: naming, readability, maintainability, or error-handling)
- severity: one of the severities above (using exactly: medium, low, or info)
- title: a short, descriptive title
- description: detailed description of the design/readability issue
- evidence: the exact line or block of code from the diff that introduces the issue
- filePath: the file path where the issue is found (infer from the diff file header or the codebase context)
- lineStart: (integer or null) start line number in the new/modified file if you can determine it, else null
- lineEnd: (integer or null) end line number in the new/modified file if you can determine it, else null
- confidence: (float between 0.0 and 1.0) your confidence score in this finding
- recommendation: clear, actionable step to improve code quality, readability, or structure

If no code quality issues are found, return: {"findings": []}
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
      console.error('[QualityAgent] Error during Gemini code review:', err);
    }

    const normalizedFindings = normalizeFindings(findings);

    return {
      agent: 'quality',
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

let cachedQualityAgent = null;

const getQualityAgent = () => {
  if (!cachedQualityAgent) {
    cachedQualityAgent = createQualityAgent();
  }

  return cachedQualityAgent;
};

module.exports = {
  QualityAgentError,
  QUALITY_CATEGORIES,
  createQualityAgent,
  getQualityAgent,
  reviewQuality: async (options) => getQualityAgent().review(options),
};