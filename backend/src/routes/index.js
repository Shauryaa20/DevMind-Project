const express = require('express');
const { handleGitHubWebhook } = require('../controllers/webhookController');
const {
  listReviews,
  getReviewById,
  listRepositories,
  indexRepository,
} = require('../controllers/reviewController');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ message: 'DevMind API base route' });
});

router.get('/reviews', listReviews);
router.get('/reviews/:id', getReviewById);
router.get('/repositories', listRepositories);
router.post('/repositories/index', indexRepository);

router.post('/webhooks/github', handleGitHubWebhook);

module.exports = router;
