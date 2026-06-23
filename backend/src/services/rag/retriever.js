const { getEmbedder } = require('./embedder');
const { getChromaService } = require('./chromaService');

const DEFAULT_TOP_K = 2;
const DEFAULT_COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'devmind-pr-reviews';

class RetrieverError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'RetrieverError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizePullRequestDiff = (pullRequestDiff) => {
  if (typeof pullRequestDiff !== 'string') {
    throw new RetrieverError('pullRequestDiff must be a string.', 400);
  }

  const normalized = pullRequestDiff.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    throw new RetrieverError('pullRequestDiff must not be empty.', 400);
  }

  return normalized;
};

const normalizeTopK = (topK) => {
  const parsed = Number(topK);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOP_K;
};

const normalizeCollectionName = (collectionName) => {
  const value = (collectionName || DEFAULT_COLLECTION_NAME).trim();

  if (!value) {
    throw new RetrieverError('collectionName must not be empty.', 400);
  }

  return value;
};

const buildChunkContext = (chunk, rank) => ({
  rank,
  id: chunk.id || null,
  document: chunk.document || '',
  distance: chunk.distance ?? null,
  relevanceScore:
    typeof chunk.distance === 'number' && Number.isFinite(chunk.distance)
      ? Number((1 / (1 + chunk.distance)).toFixed(6))
      : null,
  metadata: chunk.metadata || {},
  fileName: chunk.metadata?.fileName || null,
  filePath: chunk.metadata?.filePath || null,
  repository: chunk.metadata?.repository || null,
  chunkId: chunk.metadata?.chunkId || chunk.id || null,
  startLine: chunk.metadata?.startLine ?? null,
  endLine: chunk.metadata?.endLine ?? null,
  chunkIndex: chunk.metadata?.chunkIndex ?? null,
  chunkCount: chunk.metadata?.chunkCount ?? null,
});

const dedupeChunks = (chunks) => {
  const seen = new Set();
  const deduped = [];

  for (const chunk of chunks) {
    const key = [chunk.filePath, chunk.chunkId, chunk.id].filter(Boolean).join('::');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(chunk);
  }

  return deduped;
};

const createRetriever = ({ embedder = getEmbedder(), chromaService = getChromaService() } = {}) => {
  const retrieveRelevantCodeChunks = async ({
    pullRequestDiff,
    collectionName = DEFAULT_COLLECTION_NAME,
    topK = DEFAULT_TOP_K,
  }) => {
    const diffText = normalizePullRequestDiff(pullRequestDiff);
    const normalizedCollectionName = normalizeCollectionName(collectionName);
    const limit = normalizeTopK(topK);

    const embeddingResult = await embedder.embedSourceCode(diffText);
    const queryEmbedding = embeddingResult.vector;

    if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) {
      throw new RetrieverError('Failed to generate a valid query embedding.', 500);
    }

    const collection = await chromaService.getCollection(normalizedCollectionName);

    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      include: ['documents', 'metadatas', 'distances'],
    });

    const ids = Array.isArray(result.ids?.[0]) ? result.ids[0] : [];
    const documents = Array.isArray(result.documents?.[0]) ? result.documents[0] : [];
    const metadatas = Array.isArray(result.metadatas?.[0]) ? result.metadatas[0] : [];
    const distances = Array.isArray(result.distances?.[0]) ? result.distances[0] : [];

    const matchedChunks = ids.map((id, index) => ({
      id,
      document: documents[index] || '',
      metadata: metadatas[index] || {},
      distance: distances[index] ?? null,
    }));

    const normalizedChunks = dedupeChunks(matchedChunks).map((chunk, index) =>
      buildChunkContext(chunk, index + 1),
    );

    const results = normalizedChunks;
    console.log("[Retriever] Chunks:", results.length);

    results.forEach((chunk, i) => {
      console.log(
        `[Retriever] Chunk ${i}: ${chunk.document?.length || 0} chars`
      );
    });

    return {
      collectionName: normalizedCollectionName,
      topK: limit,
      query: {
        type: 'pull_request_diff',
        length: diffText.length,
        embeddingModel: embeddingResult.model,
      },
      context: normalizedChunks,
      chunks: normalizedChunks,
      raw: result,
    };
  };

  return {
    retrieveRelevantCodeChunks,
  };
};

let cachedRetriever = null;

const getRetriever = () => {
  if (!cachedRetriever) {
    cachedRetriever = createRetriever();
  }

  return cachedRetriever;
};

module.exports = {
  RetrieverError,
  createRetriever,
  getRetriever,
  retrieveRelevantCodeChunks: async (options) => getRetriever().retrieveRelevantCodeChunks(options),
};