const DEFAULT_CHUNK_LINES = 40;
const DEFAULT_OVERLAP_LINES = 12;
const DEFAULT_MAX_CHUNK_CHARS = 3000;

class ChunkerError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'ChunkerError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeFileInput = (codeFile, index = 0) => {
  if (typeof codeFile === 'string') {
    const sourceCode = codeFile.trim();

    if (!sourceCode) {
      throw new ChunkerError('codeFile must not be empty.', 400);
    }

    return {
      sourceCode,
      filePath: `code-file-${index + 1}`,
      language: 'unknown',
      id: undefined,
      metadata: {},
    };
  }

  if (!codeFile || typeof codeFile !== 'object' || Array.isArray(codeFile)) {
    throw new ChunkerError(`codeFiles[${index}] must be a string or an object.`, 400);
  }

  const sourceCode =
    typeof codeFile.sourceCode === 'string'
      ? codeFile.sourceCode.trim()
      : typeof codeFile.content === 'string'
        ? codeFile.content.trim()
        : typeof codeFile.code === 'string'
          ? codeFile.code.trim()
          : '';

  if (!sourceCode) {
    throw new ChunkerError(`codeFiles[${index}].sourceCode must not be empty.`, 400);
  }

  const filePath =
    (typeof codeFile.filePath === 'string' && codeFile.filePath.trim()) ||
    (typeof codeFile.path === 'string' && codeFile.path.trim()) ||
    (typeof codeFile.filename === 'string' && codeFile.filename.trim()) ||
    `code-file-${index + 1}`;

  const language =
    (typeof codeFile.language === 'string' && codeFile.language.trim()) ||
    inferLanguageFromFilePath(filePath) ||
    'unknown';

  const metadata =
    codeFile.metadata && typeof codeFile.metadata === 'object' && !Array.isArray(codeFile.metadata)
      ? codeFile.metadata
      : {};

  return {
    sourceCode,
    filePath,
    language,
    id:
      typeof codeFile.id === 'string' && codeFile.id.trim()
        ? codeFile.id.trim()
        : typeof codeFile.fileId === 'string' && codeFile.fileId.trim()
          ? codeFile.fileId.trim()
          : undefined,
    metadata,
  };
};

const inferLanguageFromFilePath = (filePath) => {
  if (typeof filePath !== 'string') {
    return undefined;
  }

  const lower = filePath.toLowerCase();

  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rb')) return 'ruby';
  if (lower.endsWith('.php')) return 'php';
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin';
  if (lower.endsWith('.swift')) return 'swift';
  if (lower.endsWith('.sh')) return 'bash';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.md')) return 'markdown';

  return undefined;
};

const normalizeNumber = (value, fallback) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const buildChunkId = (filePath, index) => {
  const safeFilePath = String(filePath || 'code-file').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `${safeFilePath}::chunk-${index + 1}`;
};

const buildChunkMetadata = ({
  filePath,
  language,
  index,
  totalChunks,
  startLine,
  endLine,
  lineCount,
  characterCount,
  overlapLines,
  chunkId,
  content,
  sourceCode,
  metadata,
}) => ({
  chunkId,
  content,
  filePath,
  language,
  chunkIndex: index,
  chunkCount: totalChunks,
  startLine,
  endLine,
  lineCount,
  characterCount,
  overlapLines,
  sourceCode,
  metadata,
});

const splitIntoChunks = (sourceCode, options = {}) => {
  const normalizedSource = typeof sourceCode === 'string' ? sourceCode.replace(/\r\n/g, '\n') : '';

  if (!normalizedSource.trim()) {
    throw new ChunkerError('sourceCode must be a non-empty string.', 400);
  }

  const chunkLines = normalizeNumber(options.chunkLines, DEFAULT_CHUNK_LINES);
  const overlapLines = normalizeNumber(options.overlapLines, DEFAULT_OVERLAP_LINES);
  const maxChunkChars = normalizeNumber(options.maxChunkChars, DEFAULT_MAX_CHUNK_CHARS);

  if (overlapLines >= chunkLines) {
    throw new ChunkerError('overlapLines must be smaller than chunkLines.', 400);
  }

  const lines = normalizedSource.split('\n');
  const chunks = [];
  const step = Math.max(1, chunkLines - overlapLines);

  for (let start = 0; start < lines.length; start += step) {
    let end = Math.min(lines.length, start + chunkLines);
    let chunkLinesSlice = lines.slice(start, end);

    while (chunkLinesSlice.length > 1 && chunkLinesSlice.join('\n').length > maxChunkChars) {
      end -= 1;
      chunkLinesSlice = lines.slice(start, end);
    }

    if (!chunkLinesSlice.length) {
      break;
    }

    const chunkText = chunkLinesSlice.join('\n').trimEnd();
    const actualEnd = start + chunkLinesSlice.length;

    chunks.push({
      content: chunkText,
      startLine: start + 1,
      endLine: actualEnd,
      lineCount: chunkLinesSlice.length,
      characterCount: chunkText.length,
      contextBefore: lines.slice(Math.max(0, start - overlapLines), start).join('\n').trimEnd(),
      contextAfter: lines.slice(actualEnd, Math.min(lines.length, actualEnd + overlapLines)).join('\n').trimStart(),
    });

    if (end >= lines.length) {
      break;
    }
  }

  return chunks;
};

const chunkCodeFile = (codeFile, options = {}) => {
  const normalizedFile = normalizeFileInput(codeFile);
  const { sourceCode, filePath, language, id, metadata } = normalizedFile;

  const chunkParts = splitIntoChunks(sourceCode, options);
  const totalChunks = chunkParts.length;

  return chunkParts.map((part, index) => {
    const chunkId = id ? `${id}::chunk-${index + 1}` : buildChunkId(filePath, index);
    const mergedMetadata = {
      ...metadata,
      chunkIndex: index + 1,
      chunkCount: totalChunks,
      startLine: part.startLine,
      endLine: part.endLine,
      lineCount: part.lineCount,
      characterCount: part.characterCount,
      overlapLines: normalizeNumber(options.overlapLines, DEFAULT_OVERLAP_LINES),
      contextBefore: part.contextBefore || undefined,
      contextAfter: part.contextAfter || undefined,
    };

    return buildChunkMetadata({
      filePath,
      language,
      index: index + 1,
      totalChunks,
      startLine: part.startLine,
      endLine: part.endLine,
      lineCount: part.lineCount,
      characterCount: part.characterCount,
      overlapLines: normalizeNumber(options.overlapLines, DEFAULT_OVERLAP_LINES),
      chunkId,
      content: part.content,
      sourceCode: part.content,
      metadata: mergedMetadata,
    });
  });
};

const chunkCodeFiles = (codeFiles, options = {}) => {
  const files = Array.isArray(codeFiles) ? codeFiles : [codeFiles];

  if (files.length === 0) {
    throw new ChunkerError('codeFiles must not be empty.', 400);
  }

  return files.flatMap((codeFile, index) => chunkCodeFile(codeFile, { ...options, fileIndex: index }));
};

const createChunker = () => ({
  splitIntoChunks,
  chunkCodeFile,
  chunkCodeFiles,
});

let cachedChunker = null;

const getChunker = () => {
  if (!cachedChunker) {
    cachedChunker = createChunker();
  }

  return cachedChunker;
};

module.exports = {
  ChunkerError,
  createChunker,
  getChunker,
  splitIntoChunks,
  chunkCodeFile,
  chunkCodeFiles,
};