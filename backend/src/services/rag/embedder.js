const { pipeline } = require('@xenova/transformers');

const DEFAULT_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const DEFAULT_TIMEOUT_MS = 30000;
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';

class EmbedderError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'EmbedderError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getApiKey = () => {
  return process.env.OPENAI_API_KEY || 'local-embeddings-no-key-required';
};

const getConfig = () => {
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const baseUrl = process.env.OPENAI_BASE_URL || OPENAI_API_BASE_URL;
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    apiKey: getApiKey(),
    embeddingModel,
    baseUrl: baseUrl.replace(/\/$/, ''),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
};

const normalizeSourceCode = (sourceCode) => {
  if (typeof sourceCode === 'string') {
    const trimmed = sourceCode.trim();

    if (!trimmed) {
      throw new EmbedderError('sourceCode must not be empty.', 400);
    }

    return trimmed;
  }

  if (Array.isArray(sourceCode)) {
    if (sourceCode.length === 0) {
      throw new EmbedderError('sourceCode array must not be empty.', 400);
    }

    return sourceCode.map((item, index) => {
      if (typeof item !== 'string') {
        throw new EmbedderError(`sourceCode[${index}] must be a string.`, 400);
      }

      const trimmed = item.trim();

      if (!trimmed) {
        throw new EmbedderError(`sourceCode[${index}] must not be empty.`, 400);
      }

      return trimmed;
    });
  }

  throw new EmbedderError('sourceCode must be a string or an array of strings.', 400);
};

let pipelinePromise = null;
const getPipeline = () => {
  if (!pipelinePromise) {
    pipelinePromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return pipelinePromise;
};

const createEmbedder = () => {
  const config = getConfig();

  const embed = async (sourceCode, options = {}) => {
    const input = normalizeSourceCode(sourceCode);

    try {
      const extractor = await getPipeline();
      const isArray = Array.isArray(input);
      const texts = isArray ? input : [input];

      const output = await extractor(texts, { pooling: 'mean', normalize: true });

      const shape = output.dims; // [num_texts, embedding_dim]
      const size = shape[1];
      const rawData = output.data;
      const vectors = [];

      for (let i = 0; i < shape[0]; i++) {
        const start = i * size;
        const end = start + size;
        vectors.push(
          Array.from(
            rawData.subarray ? rawData.subarray(start, end) : rawData.slice(start, end),
          ),
        );
      }

      return {
        model: options.model || config.embeddingModel || 'sentence-transformers/all-MiniLM-L6-v2',
        vectors,
        vector: vectors.length === 1 ? vectors[0] : null,
        raw: {
          dims: shape,
          pooling: 'mean',
          normalize: true,
        },
      };
    } catch (error) {
      if (error instanceof EmbedderError) {
        throw error;
      }

      throw new EmbedderError(
        'Unable to generate embeddings.',
        500,
        error?.message || error,
      );
    }
  };

  return {
    model: config.embeddingModel,
    timeoutMs: config.timeoutMs,
    embed,
    embedSourceCode: embed,
    embedMany: async (sourceCodeList, options = {}) => {
      const input = normalizeSourceCode(sourceCodeList);

      if (!Array.isArray(input)) {
        return embed(input, options);
      }

      return embed(input, options);
    },
  };
};

let cachedEmbedder = null;

const getEmbedder = () => {
  if (!cachedEmbedder) {
    cachedEmbedder = createEmbedder();
  }

  return cachedEmbedder;
};

module.exports = {
  EmbedderError,
  createEmbedder,
  getEmbedder,
};