const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = 30000;
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiServiceError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'GeminiServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getApiKey = () => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new GeminiServiceError(
      'GEMINI_API_KEY is not set.',
      500,
      'Add GEMINI_API_KEY to your backend environment before calling the Gemini service.',
    );
  }

  return apiKey;
};

const getConfig = () => {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const baseUrl = process.env.GEMINI_BASE_URL || GEMINI_API_BASE_URL;
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    apiKey: getApiKey(),
    model,
    baseUrl: baseUrl.replace(/\/$/, ''),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
};

const normalizeMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new GeminiServiceError('messages must be a non-empty array.', 400);
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new GeminiServiceError(`messages[${index}] must be an object.`, 400);
    }

    const role = message.role;
    const content = message.content;

    if (typeof role !== 'string' || !role.trim()) {
      throw new GeminiServiceError(`messages[${index}].role must be a non-empty string.`, 400);
    }

    if (
      typeof content !== 'string' &&
      !Array.isArray(content) &&
      !(content && typeof content === 'object')
    ) {
      throw new GeminiServiceError(
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
  const fallback = `Gemini request failed with status ${response.status}.`;

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

  if (responseData.candidates?.[0]?.content?.parts?.[0]?.text) {
    return responseData.candidates[0].content.parts[0].text.trim();
  }

  return '';
};

const createGeminiService = () => {
  const config = getConfig();

  const request = async ({ input, temperature, maxOutputTokens }) => {
    if (!input) {
      throw new GeminiServiceError('input is required for a Gemini request.', 400);
    }

    let attempts = 0;
    const maxAttempts = 4;
    let delayMs = 2000;

    while (attempts < maxAttempts) {
      attempts++;
      const { signal, cancel } = buildAbortController(config.timeoutMs);

      try {
        let systemPrompt = '';
        const contents = [];

        for (const msg of input) {
          if (msg.role === 'system') {
            systemPrompt = (systemPrompt ? systemPrompt + '\n' : '') + msg.content;
          } else {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            contents.push({
              role,
              parts: [{ text: msg.content }],
            });
          }
        }

        if (contents.length === 0) {
          throw new GeminiServiceError('No prompt messages found in input.', 400);
        }

        const body = {
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens,
          },
        };

        if (systemPrompt) {
          body.systemInstruction = {
            parts: [{ text: systemPrompt }],
          };
        }

        const response = await fetch(`${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const message = await parseErrorResponse(response);
          const status = response.status;

          if ((status === 429 || status === 503 || status === 504) && attempts < maxAttempts) {
            console.warn(`[GeminiService] Request failed with status ${status}. Retrying attempt ${attempts}/${maxAttempts} in ${delayMs}ms...`);
            cancel();
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs *= 2;
            continue;
          }

          throw new GeminiServiceError(message, status);
        }

        const responseData = await response.json();

        console.log(
          "[Gemini]",
          responseData?.candidates?.[0]?.finishReason
        );

        console.log(
          "[Gemini Usage]",
          responseData?.usageMetadata
        );

        return {
          id: responseData.id || `gemini-${Date.now()}`,
          model: config.model,
          text: extractText(responseData),
          raw: responseData,
        };
      } catch (error) {
        console.error(`[GeminiService] Error during request execution (attempt ${attempts}/${maxAttempts}):`, error);

        const isRetryableError = 
          (error instanceof GeminiServiceError && (error.statusCode === 429 || error.statusCode === 503 || error.statusCode === 504)) ||
          error?.name === 'AbortError' ||
          error?.message?.includes('fetch failed');

        if (attempts < maxAttempts && isRetryableError) {
          cancel();
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2;
          continue;
        }

        if (error instanceof GeminiServiceError) {
          throw error;
        }

        if (error?.name === 'AbortError') {
          throw new GeminiServiceError(
            `Gemini request timed out after ${config.timeoutMs}ms.`,
            504,
          );
        }

        throw new GeminiServiceError(
          'Unable to complete the Gemini request.',
          500,
          error?.message || error,
        );
      } finally {
        cancel();
      }
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

let cachedGeminiService = null;

const getGeminiService = () => {
  if (!cachedGeminiService) {
    cachedGeminiService = createGeminiService();
  }

  return cachedGeminiService;
};

module.exports = {
  GeminiServiceError,
  createGeminiService,
  getGeminiService,
};
