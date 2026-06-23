const crypto = require('crypto');

class WebhookControllerError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'WebhookControllerError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getWebhookSecret = () => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    throw new WebhookControllerError(
      'GITHUB_WEBHOOK_SECRET is not set.',
      500,
      'Configure GITHUB_WEBHOOK_SECRET before handling GitHub webhook requests.',
    );
  }

  return secret;
};

const getRequestBodyBuffer = (req) => {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody;
  }

  if (typeof req.rawBody === 'string') {
    return Buffer.from(req.rawBody, 'utf8');
  }

  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8');
  }

  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }

  return Buffer.alloc(0);
};

const getSignatureHeader = (req) => {
  const signature = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];

  if (typeof signature !== 'string' || !signature.trim()) {
    throw new WebhookControllerError('Missing x-hub-signature-256 header.', 401);
  }

  return signature.trim();
};

const verifyWebhookSignature = ({ signature, payload, secret }) => {
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;

  const providedSignature = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    providedSignature.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignatureBuffer)
  ) {
    throw new WebhookControllerError('Invalid GitHub webhook signature.', 401);
  }
};

const parseGitHubEvent = (req) => {
  const eventName = req.headers['x-github-event'];

  if (typeof eventName !== 'string' || !eventName.trim()) {
    throw new WebhookControllerError('Missing x-github-event header.', 400);
  }

  return eventName.trim();
};

const normalizePullRequestPayload = (payload) => {
  const pullRequest = payload?.pull_request || null;
  const repository = payload?.repository || null;

  if (!pullRequest || !repository) {
    throw new WebhookControllerError('Invalid pull request webhook payload.', 400);
  }

  return {
    action: typeof payload.action === 'string' ? payload.action : 'unknown',
    repository: {
      id: repository.id ?? null,
      name: repository.name || '',
      fullName: repository.full_name || repository.name || '',
      cloneUrl: repository.clone_url || '',
      htmlUrl: repository.html_url || '',
      defaultBranch: repository.default_branch || 'main',
    },
    pullRequest: {
      id: pullRequest.id ?? null,
      number: pullRequest.number ?? null,
      title: pullRequest.title || '',
      body: pullRequest.body || '',
      state: pullRequest.state || '',
      draft: Boolean(pullRequest.draft),
      merged: Boolean(pullRequest.merged),
      headSha: pullRequest.head?.sha || '',
      baseSha: pullRequest.base?.sha || '',
      headRef: pullRequest.head?.ref || '',
      baseRef: pullRequest.base?.ref || '',
      htmlUrl: pullRequest.html_url || '',
      diffUrl: pullRequest.diff_url || '',
      patchUrl: pullRequest.patch_url || '',
      user: pullRequest.user?.login || '',
    },
    sender: payload?.sender?.login || '',
  };
};

const shouldTriggerReviewWorkflow = (action) => {
  return ['opened', 'synchronize', 'reopened', 'edited'].includes(action);
};

const triggerReviewWorkflow = async (payload) => {
  const normalized = normalizePullRequestPayload(payload);

  if (!shouldTriggerReviewWorkflow(normalized.action)) {
    return {
      triggered: false,
      reason: `Ignoring pull request action: ${normalized.action}`,
      payload: normalized,
    };
  }

  return {
    triggered: true,
    reason: 'Pull request review workflow queued.',
    payload: normalized,
  };
};

const handleGitHubWebhook = async (req, res) => {
  try {
    const secret = getWebhookSecret();
    const signature = getSignatureHeader(req);
    const payloadBuffer = getRequestBodyBuffer(req);

    if (!payloadBuffer.length) {
      throw new WebhookControllerError('Missing webhook payload body.', 400);
    }

    verifyWebhookSignature({ signature, payload: payloadBuffer, secret });

    const eventName = parseGitHubEvent(req);

    if (eventName !== 'pull_request') {
      return res.status(200).json({
        received: true,
        handled: false,
        message: `Ignored GitHub event: ${eventName}`,
      });
    }

    const result = await triggerReviewWorkflow(req.body);

    if (result.triggered) {
      const { reviewPullRequest } = require('../services/reviewService');
      setImmediate(() => {
        reviewPullRequest({
          repository: result.payload.repository,
          pullNumber: result.payload.pullRequest.number,
        }).catch((err) => {
          console.error(
            `[Webhook] Background review failed for ${result.payload.repository.fullName}#${result.payload.pullRequest.number}:`,
            err,
          );
        });
      });
    }

    return res.status(202).json({
      received: true,
      handled: true,
      event: eventName,
      ...result,
    });
  } catch (error) {
    const statusCode = error instanceof WebhookControllerError ? error.statusCode : 500;
    const message =
      error instanceof WebhookControllerError ? error.message : 'Failed to process webhook.';

    return res.status(statusCode).json({
      error: message,
      details: error instanceof WebhookControllerError ? error.details : undefined,
    });
  }
};

module.exports = {
  WebhookControllerError,
  handleGitHubWebhook,
  getRequestBodyBuffer,
  getSignatureHeader,
  parseGitHubEvent,
  shouldTriggerReviewWorkflow,
  triggerReviewWorkflow,
  verifyWebhookSignature,
};