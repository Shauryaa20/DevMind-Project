const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30000;
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';

class OpenAIServiceError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'OpenAIServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new OpenAIServiceError(
      'OPENAI_API_KEY is not set.',
      500,
      'Add OPENAI_API_KEY to your backend environment before calling the OpenAI service.',
    );
  }

  return apiKey;
};

const getConfig = () => {
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const baseUrl = process.env.OPENAI_BASE_URL || OPENAI_API_BASE_URL;
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    apiKey: getApiKey(),
    model,
    baseUrl: baseUrl.replace(/\/$/, ''),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
};

const normalizeMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new OpenAIServiceError('messages must be a non-empty array.', 400);
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new OpenAIServiceError(`messages[${index}] must be an object.`, 400);
    }

    const role = message.role;
    const content = message.content;

    if (typeof role !== 'string' || !role.trim()) {
      throw new OpenAIServiceError(`messages[${index}].role must be a non-empty string.`, 400);
    }

    if (
      typeof content !== 'string' &&
      !Array.isArray(content) &&
      !(content && typeof content === 'object')
    ) {
      throw new OpenAIServiceError(
        `messages[${index}].content must be a string, array, or object.`,
        400,
      );
    }

    return {
      role: role.trim(),
      content,
    };
  });
};

const buildAbortController = (timeoutMs) => {
  if (typeof AbortController === 'undefined') {
    return { signal: undefined, cancel: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
};

const parseErrorResponse = async (response) => {
  const fallback = `OpenAI request failed with status ${response.status}.`;

  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.message || fallback;
  } catch {
    return fallback;
  }
};

const extractText = (responseData) => {
  if (!responseData) {
    return '';
  }

  if (responseData.choices?.[0]?.message?.content) {
    return responseData.choices[0].message.content.trim();
  }

  if (typeof responseData.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }

  const output = Array.isArray(responseData.output) ? responseData.output : [];
  const segments = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];

    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        segments.push(part.text.trim());
      }
    }
  }

  return segments.join('\n').trim();
};

const createOpenAIService = () => {
  const config = getConfig();

  const request = async ({ input, instructions, temperature, maxOutputTokens, metadata }) => {
    if (!input) {
      throw new OpenAIServiceError('input is required for an OpenAI request.', 400);
    }

    const { signal, cancel } = buildAbortController(config.timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model: config.model,
          messages: input,
          temperature,
          max_tokens: maxOutputTokens,
        }),
      });

      if (!response.ok) {
        const message = await parseErrorResponse(response);
        throw new OpenAIServiceError(message, response.status);
      }

      const responseData = await response.json();

      return {
        id: responseData.id,
        model: responseData.model || config.model,
        text: extractText(responseData),
        raw: responseData,
      };
    } catch (error) {
      if (error instanceof OpenAIServiceError) {
        throw error;
      }

      if (error?.name === 'AbortError') {
        throw new OpenAIServiceError(
          `OpenAI request timed out after ${config.timeoutMs}ms.`,
          504,
        );
      }

      throw new OpenAIServiceError(
        'Unable to complete the OpenAI request.',
        500,
        error?.message || error,
      );
    } finally {
      cancel();
    }
  };

  return {
    model: config.model,
    timeoutMs: config.timeoutMs,
    request,
    generateReview: async ({ prompt, systemPrompt, temperature = 0.2, maxOutputTokens = 1200 }) => {
      const messages = normalizeMessages([
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ]);

      return request({
        input: messages,
        temperature,
        maxOutputTokens,
      });
    },
    generateChatCompletion: async ({ messages, temperature = 0.2, maxOutputTokens = 1200 }) => {
      return request({
        input: normalizeMessages(messages),
        temperature,
        maxOutputTokens,
      });
    },
  };
};

let cachedOpenAIService = null;

const getOpenAIService = () => {
  if (!cachedOpenAIService) {
    cachedOpenAIService = createOpenAIService();
  }

  return cachedOpenAIService;
};

module.exports = {
  OpenAIServiceError,
  createOpenAIService,
  getOpenAIService,
};