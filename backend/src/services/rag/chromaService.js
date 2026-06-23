const { createChromaClient } = require('../../config/chroma');
const { getEmbedder } = require('./embedder');

const DEFAULT_COLLECTION_NAME =
  process.env.CHROMA_COLLECTION || 'devmind-pr-reviews';
const DEFAULT_TOP_K = 5;

class ChromaServiceError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'ChromaServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeCollectionName = (collectionName) => {
  const value = (collectionName || DEFAULT_COLLECTION_NAME).trim();

  if (!value) {
    throw new ChromaServiceError('collectionName must not be empty.', 400);
  }

  return value;
};

const normalizeCodeText = (sourceCode) => {
  if (typeof sourceCode !== 'string') {
    throw new ChromaServiceError('sourceCode must be a string.', 400);
  }

  const trimmed = sourceCode.trim();

  if (!trimmed) {
    throw new ChromaServiceError('sourceCode must not be empty.', 400);
  }

  return trimmed;
};

const normalizeMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new ChromaServiceError('metadata must be an object.', 400);
  }

  return metadata;
};

const normalizeChunk = (chunk, index) => {
  if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
    throw new ChromaServiceError(`chunks[${index}] must be an object.`, 400);
  }

  const sourceCode = normalizeCodeText(chunk.sourceCode);
  const id = typeof chunk.id === 'string' && chunk.id.trim() ? chunk.id.trim() : undefined;
  const metadata = normalizeMetadata(chunk.metadata || {});

  return {
    id,
    sourceCode,
    metadata,
  };
};

const normalizeSearchResult = (result = {}) => {
  const ids = Array.isArray(result.ids?.[0]) ? result.ids[0] : [];
  const documents = Array.isArray(result.documents?.[0]) ? result.documents[0] : [];
  const metadatas = Array.isArray(result.metadatas?.[0]) ? result.metadatas[0] : [];
  const distances = Array.isArray(result.distances?.[0]) ? result.distances[0] : [];

  return ids.map((id, index) => ({
    id,
    document: documents[index] || '',
    metadata: metadatas[index] || {},
    distance: distances[index] ?? null,
  }));
};

const buildDocumentText = (sourceCode, metadata = {}) => {
  const language = metadata.language ? `Language: ${metadata.language}\n` : '';
  const filePath = metadata.filePath ? `File: ${metadata.filePath}\n` : '';
  return `${filePath}${language}${sourceCode}`.trim();
};

const createChromaService = () => {
  const client = createChromaClient();
  const collectionCache = new Map();
  const embedder = getEmbedder();

  // Custom dummy embedding function to prevent Chroma from instantiating DefaultEmbeddingFunction
  // and trying to load '@chroma-core/default-embed' or third-party dependencies.
  const dummyEmbeddingFunction = {
    generate: async (texts) => {
      return texts.map(() => Array(384).fill(0));
    }
  };

  const resolveCollection = async (collectionName) => {
    if (typeof client.getOrCreateCollection === 'function') {
      return client.getOrCreateCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
    }

    if (typeof client.getCollection === 'function') {
      try {
        return await client.getCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
      } catch {
        return client.createCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
      }
    }

    return client.createCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
  };

  const getCollection = async (collectionName = DEFAULT_COLLECTION_NAME) => {
    const name = normalizeCollectionName(collectionName);

    if (collectionCache.has(name)) {
      return collectionCache.get(name);
    }

    const collection = await resolveCollection(name);

    collectionCache.set(name, collection);
    return collection;
  };

  const createCollection = async (collectionName = DEFAULT_COLLECTION_NAME) => {
    const name = normalizeCollectionName(collectionName);

    if (collectionCache.has(name)) {
      return collectionCache.get(name);
    }

    try {
      const collection = await client.createCollection({ name, embeddingFunction: dummyEmbeddingFunction });
      collectionCache.set(name, collection);
      return collection;
    } catch (error) {
      if (typeof client.getOrCreateCollection === 'function') {
        const collection = await client.getOrCreateCollection({ name, embeddingFunction: dummyEmbeddingFunction });
        collectionCache.set(name, collection);
        return collection;
      }

      throw new ChromaServiceError(
        `Unable to create Chroma collection \"${name}\".`,
        500,
        error?.message || error,
      );
    }
  };

  const storeCodeEmbeddings = async ({
    sourceCode,
    embeddings,
    id,
    metadata = {},
    collectionName = DEFAULT_COLLECTION_NAME,
  }) => {
    const collection = await getCollection(collectionName);
    const code = normalizeCodeText(sourceCode);
    const normalizedMetadata = normalizeMetadata(metadata);
    const vector = Array.isArray(embeddings) ? embeddings : null;

    if (vector && !vector.length) {
      throw new ChromaServiceError('embeddings must not be empty.', 400);
    }

    const finalEmbedding = vector || (await embedder.embedSourceCode(code)).vector;

    if (!Array.isArray(finalEmbedding) || !finalEmbedding.length) {
      throw new ChromaServiceError('Failed to generate a valid embedding vector.', 500);
    }

    const document = buildDocumentText(code, normalizedMetadata);
    const chunkId = typeof id === 'string' && id.trim() ? id.trim() : `chunk_${Date.now()}`;

    await collection.add({
      ids: [chunkId],
      embeddings: [finalEmbedding],
      documents: [document],
      metadatas: [normalizedMetadata],
    });

    return {
      id: chunkId,
      document,
      metadata: normalizedMetadata,
      embedding: finalEmbedding,
    };
  };

  const storeCodeChunks = async ({ chunks, collectionName = DEFAULT_COLLECTION_NAME }) => {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new ChromaServiceError('chunks must be a non-empty array.', 400);
    }

    const collection = await getCollection(collectionName);
    const normalizedChunks = chunks.map(normalizeChunk);
    const embeddings = [];
    const ids = [];
    const documents = [];
    const metadatas = [];

    for (const chunk of normalizedChunks) {
      const { vector } = await embedder.embedSourceCode(chunk.sourceCode);

      if (!Array.isArray(vector) || !vector.length) {
        throw new ChromaServiceError('Failed to generate a valid embedding vector.', 500);
      }

      const chunkId = chunk.id || `chunk_${Date.now()}_${ids.length}`;

      ids.push(chunkId);
      embeddings.push(vector);
      documents.push(buildDocumentText(chunk.sourceCode, chunk.metadata));
      metadatas.push(chunk.metadata);
    }

    await collection.add({
      ids,
      embeddings,
      documents,
      metadatas,
    });

    return normalizedChunks.map((chunk, index) => ({
      id: ids[index],
      document: documents[index],
      metadata: metadatas[index],
      embedding: embeddings[index],
      sourceCode: chunk.sourceCode,
    }));
  };

  const searchSimilarCodeChunks = async ({
    sourceCode,
    topK = DEFAULT_TOP_K,
    collectionName = DEFAULT_COLLECTION_NAME,
  }) => {
    const collection = await getCollection(collectionName);
    const code = normalizeCodeText(sourceCode);
    const queryEmbedding = (await embedder.embedSourceCode(code)).vector;

    if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) {
      throw new ChromaServiceError('Failed to generate a valid query embedding.', 500);
    }

    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Number.isFinite(topK) && topK > 0 ? topK : DEFAULT_TOP_K,
      include: ['documents', 'metadatas', 'distances'],
    });

    return normalizeSearchResult(result);
  };

  return {
    client,
    defaultCollectionName: DEFAULT_COLLECTION_NAME,
    getCollection,
    createCollection,
    storeCodeEmbeddings,
    storeCodeChunks,
    searchSimilarCodeChunks,
  };
};

let cachedChromaService = null;

const getChromaService = () => {
  if (!cachedChromaService) {
    cachedChromaService = createChromaService();
  }

  return cachedChromaService;
};

module.exports = {
  ChromaServiceError,
  createChromaService,
  getChromaService,
};