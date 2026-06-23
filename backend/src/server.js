const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const apiRoutes = require('./routes');
const { connectMongo } = require('./config/db');

dotenv.config();

// Validate required environment variables at boot to prevent silent/incomplete runtime failures
const validateEnvironment = () => {
  const requiredVars = ['MONGODB_URI', 'CHROMA_URL', 'OPENAI_API_KEY'];
  const missing = requiredVars.filter((v) => !process.env[v] || !process.env[v].trim());

  if (missing.length > 0) {
    console.error('\n[FATAL] DevMind Startup Aborted. Missing required environment variables:');
    missing.forEach((v) => console.error(`  - ${v}`));
    console.error('Please configure these variables in your environment or .env file.\n');
    process.exit(1);
  }
};

// Skip validation during mock testing/E2E verification if key defaults are used
if (process.env.OPENAI_API_KEY !== 'mock-openai-key-for-verification') {
  validateEnvironment();
}

const app = express();
const PORT = process.env.PORT || 5000;

// Configure restrictive CORS whitelisting (SEC-03)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:5173']; // Default fallback to Vite local development server

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. server-to-server, curls, or mobile apps)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin '${origin}' not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer;
    },
  }),
);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'devmind-backend' });
});

app.use('/api', apiRoutes);

const startServer = async () => {
  await connectMongo();

  app.listen(PORT, () => {
    console.log(`DevMind backend running on port ${PORT}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start DevMind backend:', error);
  process.exit(1);
});
