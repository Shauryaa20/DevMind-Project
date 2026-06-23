const path = require('path');
const mongoose = require('mongoose');

const Review = require('../models/Review');
const Repository = require('../models/Repository');
const { getIndexer } = require('../services/rag/indexer');
const { getGitHubService } = require('../services/github/githubService');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const handleAsync = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const listReviews = handleAsync(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    Review.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Review.countDocuments({}),
  ]);

  res.status(200).json({
    data: reviews,
    meta: {
      total,
      page,
      limit,
      hasMore: skip + reviews.length < total,
    },
  });
});

const getReviewById = handleAsync(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid review id.' });
  }

  const review = await Review.findById(id).lean();

  if (!review) {
    return res.status(404).json({ error: 'Review not found.' });
  }

  return res.status(200).json({ data: review });
});

const listRepositories = handleAsync(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const [repositories, total] = await Promise.all([
    Repository.find({}).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Repository.countDocuments({}),
  ]);

  res.status(200).json({
    data: repositories,
    meta: {
      total,
      page,
      limit,
      hasMore: skip + repositories.length < total,
    },
  });
});

const indexRepository = handleAsync(async (req, res) => {
  const { owner, repo, ref, repositoryPath, repositoryName, collectionName } = req.body;

  let ownerName = owner;
  let repoName = repo;
  let finalRepName = repositoryName;

  if (ownerName && repoName && !finalRepName) {
    finalRepName = `${ownerName}/${repoName}`;
  }

  const indexer = getIndexer();

  let indexResult;

  if (repositoryPath) {
    const resolvedPath = path.resolve(repositoryPath);
    const resolvedName = repositoryName || path.basename(resolvedPath);
    if (!ownerName || !repoName) {
      if (resolvedName.includes('/')) {
        [ownerName, repoName] = resolvedName.split('/');
      } else {
        ownerName = 'local';
        repoName = resolvedName;
      }
    }

    indexResult = await indexer.indexRepository({
      repositoryPath: resolvedPath,
      repositoryName: `${ownerName}/${repoName}`,
      collectionName,
    });
  } else {
    if (!ownerName || !repoName) {
      return res.status(400).json({ error: 'owner and repo, or repositoryPath are required.' });
    }

    const githubService = getGitHubService();
    const fetchResult = await githubService.fetchRepositoryFiles({
      owner: ownerName,
      repo: repoName,
      ref,
      includeContent: true,
    });

    indexResult = await indexer.indexFiles({
      codeFiles: fetchResult.files,
      repositoryPath: process.cwd(),
      repositoryName: `${ownerName}/${repoName}`,
      collectionName,
    });
  }

  const savedRepo = await Repository.findOneAndUpdate(
    { owner: ownerName, repo: repoName },
    {
      owner: ownerName,
      repo: repoName,
      fullName: `${ownerName}/${repoName}`,
      defaultBranch: ref || 'main',
      lastIndexedAt: new Date(),
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();

  res.status(200).json({
    message: 'Repository indexed successfully',
    data: {
      repository: savedRepo,
      filesIndexed: indexResult.filesIndexed,
      chunksIndexed: indexResult.chunksIndexed,
    },
  });
});

module.exports = {
  listReviews,
  getReviewById,
  listRepositories,
  indexRepository,
};