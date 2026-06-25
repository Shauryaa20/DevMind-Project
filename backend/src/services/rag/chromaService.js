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
  console.log('[INDEX] Chroma client creation started');
  const clientStart = Date.now();
  let client;
  try {
    client = createChromaClient();
    console.log(`[INDEX] Chroma client created successfully in ${Date.now() - clientStart} ms`);
  } catch (error) {
    console.error("[INDEX] FAILED during Chroma client creation", error);
    throw error;
  }
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
    console.log(`[Chroma Diagnostic] Resolving collection "${collectionName}"...`);
    try {
      let collection;
      if (typeof client.getOrCreateCollection === 'function') {
        console.log(`[Chroma Diagnostic] Invoking client.getOrCreateCollection for "${collectionName}"`);
        collection = await client.getOrCreateCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
      } else if (typeof client.getCollection === 'function') {
        try {
          console.log(`[Chroma Diagnostic] Invoking client.getCollection for "${collectionName}"`);
          collection = await client.getCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
        } catch (getErr) {
          console.log(`[Chroma Diagnostic] client.getCollection failed, falling back to client.createCollection: ${getErr.message || getErr}`);
          collection = await client.createCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
        }
      } else {
        console.log(`[Chroma Diagnostic] Invoking client.createCollection for "${collectionName}"`);
        collection = await client.createCollection({ name: collectionName, embeddingFunction: dummyEmbeddingFunction });
      }
      console.log(`[Chroma Diagnostic] Successfully resolved collection "${collectionName}"`);
      return collection;
    } catch (error) {
      console.error(`[Chroma Diagnostic] Failed to resolve collection "${collectionName}":`, error);
      throw error;
    }
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
      console.log(`[Chroma Diagnostic] Creating collection "${name}"...`);
      const collection = await client.createCollection({ name, embeddingFunction: dummyEmbeddingFunction });
      console.log(`[Chroma Diagnostic] Successfully created collection "${name}"`);
      collectionCache.set(name, collection);
      return collection;
    } catch (error) {
      console.warn(`[Chroma Diagnostic] createCollection failed for "${name}": ${error.message || error}. Trying fallback...`);
      if (typeof client.getOrCreateCollection === 'function') {
        try {
          const collection = await client.getOrCreateCollection({ name, embeddingFunction: dummyEmbeddingFunction });
          console.log(`[Chroma Diagnostic] Successfully resolved collection via fallback getOrCreateCollection for "${name}"`);
          collectionCache.set(name, collection);
          return collection;
        } catch (fallbackError) {
          console.error(`[Chroma Diagnostic] Fallback getOrCreateCollection also failed for "${name}":`, fallbackError);
          throw fallbackError;
        }
      }

      console.error(`[Chroma Diagnostic] Failed to create collection "${name}":`, error);
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

    console.log('[INDEX] Connecting to Chroma...');
    const connectStart = Date.now();
    let collection;
    try {
      collection = await getCollection(collectionName);
      console.log(`[INDEX] Chroma connected in ${Date.now() - connectStart} ms`);
      console.log('[INDEX] Collection loaded');
    } catch (error) {
      console.error("[INDEX] FAILED during Chroma collection retrieval/creation", error);
      throw error;
    }

    const normalizedChunks = chunks.map(normalizeChunk);
    const embeddings = [];
    const ids = [];
    const documents = [];
    const metadatas = [];

    console.log('[INDEX] Starting embeddings...');
    const embeddingStart = Date.now();
    try {
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
      console.log(`[INDEX] Embeddings complete in ${Date.now() - embeddingStart} ms`);
    } catch (error) {
      console.error("[INDEX] FAILED during Embedding generation", error);
      throw error;
    }

    console.log('[INDEX] Uploading vectors...');
    const uploadStart = Date.now();
    try {
      await collection.add({
        ids,
        embeddings,
        documents,
        metadatas,
      });
      console.log(`[INDEX] Upload complete in ${Date.now() - uploadStart} ms`);
    } catch (error) {
      console.error("[INDEX] FAILED during Chroma insert/upsert", error);
      throw error;
    }

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