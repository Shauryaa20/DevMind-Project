const { getGitHubService, normalizeRepoInput } = require('./github/githubService');
const { getRetriever } = require('./rag/retriever');
const { createSecurityAgent } = require('./agents/securityAgent');
const { createPerformanceAgent } = require('./agents/performanceAgent');
const { createQualityAgent } = require('./agents/qualityAgent');
const { createAggregatorAgent } = require('./agents/aggregatorAgent');
const severityServiceModule = require('./severityService');
const ReviewModel = require('../models/Review');

const DEFAULT_COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'devmind-pr-reviews';
const DEFAULT_TOP_K = 2;

class ReviewServiceError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'ReviewServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeTopK = (topK) => {
  const parsed = Number(topK);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOP_K;
};

const normalizeCollectionName = (collectionName) => {
  const value = (collectionName || DEFAULT_COLLECTION_NAME).trim();

  if (!value) {
    throw new ReviewServiceError('collectionName must not be empty.', 400);
  }

  return value;
};

const normalizePullNumber = (pullNumber) => {
  const parsed = Number(pullNumber);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ReviewServiceError('pullNumber must be a positive integer.', 400);
  }

  return parsed;
};

const buildContextRetriever = (repositoryContext) => ({
  retrieveRelevantCodeChunks: async () => repositoryContext,
});

const persistReviewDocument = async ({ reviewModel, document }) => {
  if (!reviewModel) {
    throw new ReviewServiceError('A reviewModel is required.', 500);
  }

  if (typeof reviewModel.create === 'function') {
    return reviewModel.create(document);
  }

  const instance = new reviewModel(document);

  if (typeof instance.save === 'function') {
    return instance.save();
  }

  throw new ReviewServiceError('reviewModel must support create() or be instantiable with save().', 500);
};

const createReviewService = ({
  githubService = getGitHubService(),
  retriever = getRetriever(),
  securityAgentFactory = createSecurityAgent,
  performanceAgentFactory = createPerformanceAgent,
  qualityAgentFactory = createQualityAgent,
  aggregatorAgentFactory = createAggregatorAgent,
  severityService = severityServiceModule,
  reviewModel = ReviewModel,
} = {}) => {
  const reviewPullRequest = async ({
    repository,
    owner,
    repo,
    pullNumber,
    collectionName = DEFAULT_COLLECTION_NAME,
    topK = DEFAULT_TOP_K,
    pullRequestDiff,
  }) => {
    const normalizedRepository = normalizeRepoInput(repository || owner, repo);
    const normalizedPullNumber = normalizePullNumber(pullNumber);
    const normalizedCollectionName = normalizeCollectionName(collectionName);
    const normalizedTopK = normalizeTopK(topK);

    // Initial state persistence: save the review as 'running'
    let reviewDoc;
    try {
      reviewDoc = await reviewModel.findOneAndUpdate(
        {
          'repository.fullName': `${normalizedRepository.owner}/${normalizedRepository.repo}`,
          'pullRequest.number': normalizedPullNumber,
        },
        {
          repository: {
            owner: normalizedRepository.owner,
            repo: normalizedRepository.repo,
            fullName: `${normalizedRepository.owner}/${normalizedRepository.repo}`,
            ref: normalizedRepository.ref || null,
          },
          pullRequest: {
            number: normalizedPullNumber,
            diff: pullRequestDiff || 'Fetching git diff...',
            collectionName: normalizedCollectionName,
            topK: normalizedTopK,
          },
          status: 'running',
          error: null,
          reviewedAt: new Date(),
        },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (dbErr) {
      console.error('[ReviewService] Failed to create initial running review document:', dbErr);
    }

    try {
      const diffText =
        typeof pullRequestDiff === 'string' && pullRequestDiff.trim()
          ? pullRequestDiff.replace(/\r\n/g, '\n').trim()
          : await githubService.fetchPullRequestDiff({
              repository: normalizedRepository,
              pullNumber: normalizedPullNumber,
            });

      if (typeof diffText !== 'string' || !diffText.trim()) {
        throw new ReviewServiceError('Unable to fetch a valid pull request diff.', 500);
      }

      // Update diff in progress document if it was fetched from GitHub
      if (reviewDoc && !pullRequestDiff) {
        reviewDoc.pullRequest.diff = diffText;
        await reviewDoc.save().catch(() => {});
      }

      const repositoryContext = await retriever.retrieveRelevantCodeChunks({
        pullRequestDiff: diffText,
        collectionName: normalizedCollectionName,
        topK: normalizedTopK,
      });

      const contextRetriever = buildContextRetriever(repositoryContext);

      const securityAgent = securityAgentFactory({ retriever: contextRetriever });
      const performanceAgent = performanceAgentFactory({ retriever: contextRetriever });
      const qualityAgent = qualityAgentFactory({ retriever: contextRetriever });
      const aggregatorAgent = aggregatorAgentFactory();

      const securityReport = await securityAgent.review({
        pullRequestDiff: diffText,
        collectionName: normalizedCollectionName,
        topK: normalizedTopK,
      });
      const performanceReport = await performanceAgent.review({
        pullRequestDiff: diffText,
        collectionName: normalizedCollectionName,
        topK: normalizedTopK,
      });
      const qualityReport = await qualityAgent.review({
        pullRequestDiff: diffText,
        collectionName: normalizedCollectionName,
        topK: normalizedTopK,
      });

      const consolidatedReport = await aggregatorAgent.aggregate({
        security: securityReport,
        performance: performanceReport,
        quality: qualityReport,
        title: `DevMind Review - ${normalizedRepository.owner}/${normalizedRepository.repo}#${normalizedPullNumber}`,
      });

      const severityReport = severityService.categorizeFindings(consolidatedReport.findings);

      const document = {
        repository: {
          owner: normalizedRepository.owner,
          repo: normalizedRepository.repo,
          fullName: `${normalizedRepository.owner}/${normalizedRepository.repo}`,
          ref: normalizedRepository.ref || null,
        },
        pullRequest: {
          number: normalizedPullNumber,
          diff: diffText,
          collectionName: normalizedCollectionName,
          topK: normalizedTopK,
        },
        repositoryContext,
        securityReport,
        performanceReport,
        qualityReport,
        aggregatedReport: consolidatedReport,
        severityReport,
        findings: consolidatedReport.findings,
        summary: consolidatedReport.summary,
        status: 'completed',
        reviewedAt: new Date(),
        error: null,
      };

      let storedReview;
      if (reviewDoc) {
        // Update existing document
        Object.assign(reviewDoc, document);
        storedReview = await reviewDoc.save();
      } else {
        // Fallback create
        storedReview = await persistReviewDocument({ reviewModel, document });
      }

      return {
        repository: document.repository,
        pullRequest: document.pullRequest,
        repositoryContext,
        securityReport,
        performanceReport,
        qualityReport,
        consolidatedReport,
        severityReport,
        storedReview,
      };
    } catch (err) {
      if (reviewDoc) {
        reviewDoc.status = 'failed';
        reviewDoc.error = {
          message: err.message || 'Unknown review error',
          statusCode: err.statusCode || 500,
        };
        await reviewDoc.save().catch((dbErr) => {
          console.error('[ReviewService] Failed to save review failure state:', dbErr);
        });
      }
      throw err;
    }
  };

  return {
    reviewPullRequest,
  };
};

let cachedReviewService = null;

const getReviewService = () => {
  if (!cachedReviewService) {
    cachedReviewService = createReviewService();
  }

  return cachedReviewService;
};

module.exports = {
  ReviewServiceError,
  createReviewService,
  getReviewService,
  reviewPullRequest: async (options) => getReviewService().reviewPullRequest(options),
};