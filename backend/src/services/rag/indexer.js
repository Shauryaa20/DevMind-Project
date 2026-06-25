const fs = require('fs');
const path = require('path');
const { getChunker } = require('./chunker');
const { getChromaService } = require('./chromaService');

const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const DEFAULT_COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'devmind-pr-reviews';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.next',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  '.cache',
  '.turbo',
]);

const DEFAULT_CODE_EXTENSIONS = new Set([
  '.cjs',
  '.cs',
  '.go',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.kts',
  '.md',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);

const DEFAULT_CODE_FILENAMES = new Set([
  'Dockerfile',
  'Makefile',
  'Procfile',
  '.env.example',
  '.dockerignore',
  'package.json',
  'tsconfig.json',
  'vite.config.js',
]);

class IndexerError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'IndexerError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeRepositoryName = (repositoryPath, repositoryName) => {
  const value = (repositoryName || path.basename(path.resolve(repositoryPath || '.'))).trim();

  if (!value) {
    throw new IndexerError('repositoryName must not be empty.', 400);
  }

  return value;
};

const normalizeRepositoryPath = (repositoryPath) => {
  if (typeof repositoryPath !== 'string' || !repositoryPath.trim()) {
    throw new IndexerError('repositoryPath must be a non-empty string.', 400);
  }

  return path.resolve(repositoryPath);
};

const normalizeRelativePath = (absolutePath, repositoryPath) => {
  return path.relative(repositoryPath, absolutePath).split(path.sep).join('/');
};

const isAllowedFile = (filePath, options = {}) => {
  const baseName = path.basename(filePath);
  const extension = path.extname(baseName).toLowerCase();

  // Exclude lock files
  if (baseName === 'package-lock.json' || baseName === 'pnpm-lock.yaml' || baseName === 'yarn.lock' || baseName === 'bun.lockb') {
    return false;
  }

  // Exclude styling files
  if (extension === '.css' || extension === '.scss' || extension === '.sass' || extension === '.less') {
    return false;
  }

  // Exclude repository metadata/configuration
  if (baseName === '.gitignore' || baseName === '.gitattributes' || baseName === '.editorconfig') {
    return false;
  }

  // Exclude minified assets
  if (baseName.endsWith('.min.js') || baseName.endsWith('.min.css')) {
    return false;
  }

  const allowedExtensions = new Set(
    Array.isArray(options.allowedExtensions) && options.allowedExtensions.length > 0
      ? options.allowedExtensions.map((extension) => String(extension).toLowerCase())
      : Array.from(DEFAULT_CODE_EXTENSIONS),
  );

  const allowedFileNames = new Set(
    Array.isArray(options.allowedFileNames) && options.allowedFileNames.length > 0
      ? options.allowedFileNames
      : Array.from(DEFAULT_CODE_FILENAMES),
  );

  if (allowedFileNames.has(baseName)) {
    return true;
  }

  if (baseName.startsWith('.env.') || baseName === '.env.example') {
    return true;
  }

  return allowedExtensions.has(extension);
};

const shouldIgnoreDirectory = (directoryName, options = {}) => {
  const ignoredDirectories = new Set(
    Array.isArray(options.ignoredDirectories) && options.ignoredDirectories.length > 0
      ? options.ignoredDirectories
      : Array.from(DEFAULT_IGNORED_DIRECTORIES),
  );

  return ignoredDirectories.has(directoryName);
};

const normalizeMaxFileSize = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FILE_SIZE_BYTES;
};

const isReadableText = (buffer) => {
  if (!buffer || buffer.length === 0) {
    return false;
  }

  return !buffer.includes(0);
};

const readRepositoryFiles = async (repositoryPath, options = {}) => {
  const rootPath = normalizeRepositoryPath(repositoryPath);
  const maxFileSizeBytes = normalizeMaxFileSize(options.maxFileSizeBytes);
  const files = [];

  console.log('[INDEX] Discovering files...');
  const walkStart = Date.now();
  let totalDiscovered = 0;

  const walk = async (currentPath) => {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name, options)) {
          await walk(absolutePath);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      totalDiscovered++;

      if (!isAllowedFile(absolutePath, options)) {
        continue;
      }

      const stat = await fs.promises.stat(absolutePath);

      if (stat.size > maxFileSizeBytes) {
        continue;
      }

      const buffer = await fs.promises.readFile(absolutePath);

      if (!isReadableText(buffer)) {
        continue;
      }

      const sourceCode = buffer.toString('utf8').trim();

      if (!sourceCode) {
        continue;
      }

      const relativePath = normalizeRelativePath(absolutePath, rootPath);

      files.push({
        absolutePath,
        relativePath,
        fileName: path.basename(absolutePath),
        language: path.extname(absolutePath).replace(/^\./, '').toLowerCase() || 'unknown',
        sourceCode,
        sizeBytes: stat.size,
      });
    }
  };

  try {
    await walk(rootPath);
    console.log(`[INDEX] Files discovered: ${totalDiscovered} in ${Date.now() - walkStart} ms`);
    console.log('[INDEX] Filtering supported files...');
    console.log(`[INDEX] Supported files: ${files.length}`);
    return files;
  } catch (error) {
    console.error("[INDEX] FAILED during File traversal", error);
    throw error;
  }
};

const createIndexer = ({ chunker = getChunker(), chromaService = getChromaService() } = {}) => {
  const indexRepository = async ({
    repositoryPath,
    repositoryName,
    collectionName = DEFAULT_COLLECTION_NAME,
    chunkOptions = {},
    fileOptions = {},
  }) => {
    const normalizedRepositoryPath = normalizeRepositoryPath(repositoryPath);
    const normalizedRepositoryName = normalizeRepositoryName(
      normalizedRepositoryPath,
      repositoryName,
    );

    const codeFiles = await readRepositoryFiles(normalizedRepositoryPath, fileOptions);

    if (codeFiles.length === 0) {
      return {
        repositoryName: normalizedRepositoryName,
        repositoryPath: normalizedRepositoryPath,
        collectionName,
        filesIndexed: 0,
        chunksIndexed: 0,
        indexedChunks: [],
        files: [],
      };
    }

    console.log('[INDEX] Chunk generation started');
    const chunkStart = Date.now();
    let chunkRecords;
    try {
      chunkRecords = codeFiles.flatMap((file) => {
        const chunks = chunker.chunkCodeFile(
          {
            sourceCode: file.sourceCode,
            filePath: file.relativePath,
            language: file.language,
            id: file.relativePath,
            metadata: {
              repository: normalizedRepositoryName,
              repositoryPath: normalizedRepositoryPath,
              fileName: file.fileName,
              filePath: file.relativePath,
              absolutePath: file.absolutePath,
              fileSizeBytes: file.sizeBytes,
            },
          },
          chunkOptions,
        );

        return chunks.map((chunk) => ({
          id: chunk.chunkId,
          sourceCode: chunk.content,
          metadata: {
            ...chunk.metadata,
            repository: normalizedRepositoryName,
            repositoryPath: normalizedRepositoryPath,
            fileName: file.fileName,
            filePath: file.relativePath,
            absolutePath: file.absolutePath,
            chunkId: chunk.chunkId,
          },
        }));
      });
      console.log(`[INDEX] Chunks generated: ${chunkRecords.length} in ${Date.now() - chunkStart} ms`);
      const totalSupportedFiles = codeFiles.length;
      const totalGeneratedChunks = chunkRecords.length;
      const avgChunks = totalSupportedFiles > 0 ? (totalGeneratedChunks / totalSupportedFiles) : 0;
      console.log(`[INDEX] Total supported files: ${totalSupportedFiles}`);
      console.log(`[INDEX] Total generated chunks: ${totalGeneratedChunks}`);
      console.log(`[INDEX] Average chunks per file: ${avgChunks.toFixed(2)}`);
    } catch (error) {
      console.error("[INDEX] FAILED during Chunk generation", error);
      throw error;
    }

    const indexedChunks = await chromaService.storeCodeChunks({
      chunks: chunkRecords,
      collectionName,
    });

    return {
      repositoryName: normalizedRepositoryName,
      repositoryPath: normalizedRepositoryPath,
      collectionName,
      filesIndexed: codeFiles.length,
      chunksIndexed: indexedChunks.length,
      indexedChunks,
      files: codeFiles.map((file) => ({
        fileName: file.fileName,
        filePath: file.relativePath,
        language: file.language,
        sizeBytes: file.sizeBytes,
      })),
    };
  };

  const indexFiles = async ({
    codeFiles,
    repositoryPath = process.cwd(),
    repositoryName,
    collectionName = DEFAULT_COLLECTION_NAME,
    chunkOptions = {},
    fileOptions = {},
  }) => {
    console.log('[INDEX] Discovering files...');
    const discoverStart = Date.now();

    if (!Array.isArray(codeFiles) || codeFiles.length === 0) {
      console.log(`[INDEX] Files discovered: 0 in ${Date.now() - discoverStart} ms`);
      throw new IndexerError('codeFiles must be a non-empty array.', 400);
    }

    const totalDiscovered = codeFiles.length;
    console.log(`[INDEX] Files discovered: ${totalDiscovered} in ${Date.now() - discoverStart} ms`);

    console.log('[INDEX] Filtering supported files...');
    const filterStart = Date.now();

    const normalizedRepositoryPath = normalizeRepositoryPath(repositoryPath);
    const normalizedRepositoryName = normalizeRepositoryName(
      normalizedRepositoryPath,
      repositoryName,
    );

    // Normalize codeFiles to ensure checkable sourceCode is populated (supporting both sourceCode and content fields)
    const normalizedFiles = codeFiles.map((file, index) => {
      const sourceCode = typeof file.sourceCode === 'string'
        ? file.sourceCode
        : typeof file.content === 'string'
          ? file.content
          : '';

      const relativePath =
        typeof file.relativePath === 'string' && file.relativePath.trim()
          ? file.relativePath.trim().split(path.sep).join('/')
          : typeof file.filePath === 'string' && file.filePath.trim()
            ? file.filePath.trim().split(path.sep).join('/')
            : undefined;

      const absolutePath =
        typeof file.absolutePath === 'string' && file.absolutePath.trim()
          ? path.resolve(file.absolutePath)
          : relativePath
            ? path.join(normalizedRepositoryPath, relativePath)
            : path.join(normalizedRepositoryPath, `file-${index + 1}`);

      const finalRelativePath = relativePath || normalizeRelativePath(absolutePath, normalizedRepositoryPath);

      const fileName =
        typeof file.fileName === 'string' && file.fileName.trim()
          ? file.fileName.trim()
          : path.basename(finalRelativePath);

      const language =
        typeof file.language === 'string' && file.language.trim()
          ? file.language.trim()
          : 'unknown';

      return {
        ...file,
        sourceCode,
        relativePath: finalRelativePath,
        absolutePath,
        fileName,
        language,
      };
    });

    // Filter out invalid/empty files, and check exclusions using isAllowedFile
    const validFiles = normalizedFiles.filter(
      file =>
        file &&
        typeof file.sourceCode === "string" &&
        file.sourceCode.trim().length > 0 &&
        isAllowedFile(file.relativePath, fileOptions)
    );

    // Log skipped files
    codeFiles.forEach((file) => {
      const sourceCode = typeof file.sourceCode === 'string'
        ? file.sourceCode
        : typeof file.content === 'string'
          ? file.content
          : '';
      if (!sourceCode || !sourceCode.trim()) {
        console.warn(
          `[Indexer] Skipping empty file: ${file.path || file.filename || file.relativePath || file.fileName || 'unknown'}`
        );
      }
    });

    console.log(`[INDEX] Supported files: ${validFiles.length} in ${Date.now() - filterStart} ms`);

    if (validFiles.length === 0) {
      return {
        repositoryName: normalizedRepositoryName,
        repositoryPath: normalizedRepositoryPath,
        collectionName,
        filesIndexed: 0,
        chunksIndexed: 0,
        indexedChunks: [],
      };
    }

    console.log('[INDEX] Chunk generation started');
    const chunkStart = Date.now();
    let chunkRecords;
    try {
      chunkRecords = validFiles.flatMap((file) => {
        const chunks = chunker.chunkCodeFile(
          {
            sourceCode: file.sourceCode,
            filePath: file.relativePath,
            language: file.language,
            id: file.relativePath,
            metadata: {
              repository: normalizedRepositoryName,
              repositoryPath: normalizedRepositoryPath,
              fileName: file.fileName,
              filePath: file.relativePath,
              absolutePath: file.absolutePath,
            },
          },
          chunkOptions,
        );

        return chunks.map((chunk) => ({
          id: chunk.chunkId,
          sourceCode: chunk.content,
          metadata: {
            ...chunk.metadata,
            repository: normalizedRepositoryName,
            repositoryPath: normalizedRepositoryPath,
            fileName: file.fileName,
            filePath: file.relativePath,
            absolutePath: file.absolutePath,
            chunkId: chunk.chunkId,
          },
        }));
      });
      console.log(`[INDEX] Chunks generated: ${chunkRecords.length} in ${Date.now() - chunkStart} ms`);
      const totalSupportedFiles = validFiles.length;
      const totalGeneratedChunks = chunkRecords.length;
      const avgChunks = totalSupportedFiles > 0 ? (totalGeneratedChunks / totalSupportedFiles) : 0;
      console.log(`[INDEX] Total supported files: ${totalSupportedFiles}`);
      console.log(`[INDEX] Total generated chunks: ${totalGeneratedChunks}`);
      console.log(`[INDEX] Average chunks per file: ${avgChunks.toFixed(2)}`);
    } catch (error) {
      console.error("[INDEX] FAILED during Chunk generation", error);
      throw error;
    }

    const indexedChunks = await chromaService.storeCodeChunks({
      chunks: chunkRecords,
      collectionName,
    });

    return {
      repositoryName: normalizedRepositoryName,
      repositoryPath: normalizedRepositoryPath,
      collectionName,
      filesIndexed: validFiles.length,
      chunksIndexed: indexedChunks.length,
      indexedChunks,
    };
  };

  return {
    indexRepository,
    indexFiles,
    readRepositoryFiles,
  };
};

let cachedIndexer = null;

const getIndexer = () => {
  if (!cachedIndexer) {
    cachedIndexer = createIndexer();
  }

  return cachedIndexer;
};

module.exports = {
  IndexerError,
  createIndexer,
  getIndexer,
  readRepositoryFiles,
};