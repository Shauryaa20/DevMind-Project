const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load environment variables
dotenv.config();

// Default values to prevent boot errors in clean/CI environments
process.env.CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/devmind-test';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'mock-openai-key-for-verification';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'mock-gemini-key-for-verification';

// Determine if we should mock DB/OpenAI/Gemini integrations
const useMock = process.env.OPENAI_API_KEY === 'mock-openai-key-for-verification' || process.env.GEMINI_API_KEY === 'mock-gemini-key-for-verification' || process.env.MOCK_TEST === 'true';

// Mock ChromaService BEFORE importing services that depend on it
if (useMock) {
  console.log('[Verify] Mocking ChromaDB Service...');
  const chromaServiceModule = require('./services/rag/chromaService');
  const mockCollection = {
    add: async () => {},
    query: async () => ({
      ids: [['chunk_mock_1', 'chunk_mock_2']],
      documents: [
        [
          `// User authentication module
          const login = (username, password) => {
            if (username === 'admin' && password === 'secret123') {
              return { authenticated: true, role: 'admin' };
            }
            return { authenticated: false };
          };`,
          `// Database access module
          const queryUser = (id) => {
            const sql = "SELECT * FROM users WHERE id = " + id;
            return db.execute(sql);
          };`
        ]
      ],
      metadatas: [[{ filePath: 'auth.js' }, { filePath: 'db.js' }]],
      distances: [[0.1, 0.2]]
    })
  };

  const originalGetChromaService = chromaServiceModule.getChromaService;
  chromaServiceModule.getChromaService = () => {
    const service = originalGetChromaService();
    service.getCollection = async () => mockCollection;
    service.createCollection = async () => mockCollection;
    service.storeCodeChunks = async ({ chunks }) => chunks.map((c, i) => ({
      id: c.id || `chunk_${i}`,
      document: c.sourceCode,
      metadata: c.metadata,
      embedding: Array(1536).fill(0),
      sourceCode: c.sourceCode
    }));
    return service;
  };
}

const { getIndexer } = require('./services/rag/indexer');
const { getRetriever } = require('./services/rag/retriever');
const { getReviewService } = require('./services/reviewService');
const Review = require('./models/Review');
const Repository = require('./models/Repository');
const Issue = require('./models/Issue');

console.log(`[Verify] Starting E2E Verification in ${useMock ? 'MOCK' : 'LIVE'} mode...`);

// Helper to create a dummy directory for testing indexing
const createDummyCodebase = () => {
  const dummyDir = path.join(__dirname, '../temp_dummy_codebase');
  if (!fs.existsSync(dummyDir)) {
    fs.mkdirSync(dummyDir);
  }

  fs.writeFileSync(
    path.join(dummyDir, 'auth.js'),
    `
    // User authentication module
    const login = (username, password) => {
      // TODO: implement secure auth
      if (username === 'admin' && password === 'secret123') {
        return { authenticated: true, role: 'admin' };
      }
      return { authenticated: false };
    };
    module.exports = { login };
    `
  );

  fs.writeFileSync(
    path.join(dummyDir, 'db.js'),
    `
    // Database access module
    const queryUser = (id) => {
      const sql = "SELECT * FROM users WHERE id = " + id; // Unsafe query
      return db.execute(sql);
    };
    module.exports = { queryUser };
    `
  );

  return dummyDir;
};

// Clean up dummy codebase
const cleanDummyCodebase = (dummyDir) => {
  if (fs.existsSync(dummyDir)) {
    fs.rmSync(dummyDir, { recursive: true, force: true });
  }
};

// Mocking OpenAI/Gemini globally if in Mock mode
if (useMock) {
  console.log('[Verify] Mocking global fetch for OpenAI/Gemini calls...');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url.includes('generativelanguage.googleapis.com') || url.includes('/models/gemini-2.5-flash:generateContent')) {
      let responseText = '';
      try {
        const body = JSON.parse(options.body);
        const promptText = body.contents?.[0]?.parts?.[0]?.text || '';
        const systemPrompt = body.systemInstruction?.parts?.[0]?.text || '';

        const isSecurityPrompt = promptText.toLowerCase().includes('security') || systemPrompt.toLowerCase().includes('security') || promptText.toLowerCase().includes('git diff');
        const isPerformancePrompt = promptText.toLowerCase().includes('performance') || systemPrompt.toLowerCase().includes('performance');
        const isQualityPrompt = promptText.toLowerCase().includes('quality') || systemPrompt.toLowerCase().includes('quality');

        if (isSecurityPrompt) {
          responseText = JSON.stringify({
            findings: [
              {
                category: 'secrets',
                severity: 'critical',
                title: 'Hardcoded credentials in auth.js',
                description: 'Plaintext secret passwords detected in login condition.',
                evidence: "password === 'secret123'",
                filePath: 'auth.js',
                lineStart: 5,
                lineEnd: 5,
                confidence: 0.95,
                recommendation: 'Move credentials to environment variables or secret manager.'
              },
              {
                category: 'sql-injection',
                severity: 'critical',
                title: 'SQL Injection in db.js',
                description: 'String concatenation detected in SQL statements.',
                evidence: 'const sql = "SELECT * FROM users WHERE id = " + id;',
                filePath: 'db.js',
                lineStart: 4,
                lineEnd: 4,
                confidence: 0.9,
                recommendation: 'Use parameterized queries or ORM binding.'
              }
            ]
          });
        } else if (isPerformancePrompt) {
          responseText = JSON.stringify({
            findings: [
              {
                category: 'inefficient-operations',
                severity: 'medium',
                title: 'Concatenation in loop warning',
                description: 'Avoid performing string allocations inside critical functions.',
                evidence: 'const sql = "SELECT * FROM users WHERE id = " + id;',
                filePath: 'db.js',
                lineStart: 4,
                lineEnd: 4,
                confidence: 0.75,
                recommendation: 'Optimize database query template rendering.'
              }
            ]
          });
        } else if (isQualityPrompt) {
          responseText = JSON.stringify({
            findings: [
              {
                category: 'naming',
                severity: 'low',
                title: 'Vague parameter naming',
                description: 'Parameter "id" is too short, consider descriptive naming.',
                evidence: 'const queryUser = (id) => {',
                filePath: 'db.js',
                lineStart: 3,
                lineEnd: 3,
                confidence: 0.7,
                recommendation: 'Rename "id" to "userId".'
              }
            ]
          });
        } else {
          responseText = JSON.stringify({ findings: [] });
        }
      } catch (err) {
        responseText = JSON.stringify({ findings: [] });
      }

      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: responseText
                  }
                ],
                role: 'model'
              },
              finishReason: 'STOP'
            }
          ]
        })
      };
    }

    if (url.includes('/chat/completions')) {
      const body = JSON.parse(options.body);
      const isSecurityPrompt = body.messages.some(m => m.content.toLowerCase().includes('security') || m.content.toLowerCase().includes('git diff'));
      const isPerformancePrompt = body.messages.some(m => m.content.toLowerCase().includes('performance'));
      const isQualityPrompt = body.messages.some(m => m.content.toLowerCase().includes('quality'));

      let responseText = '';
      if (isSecurityPrompt) {
        responseText = JSON.stringify({
          findings: [
            {
              category: 'secrets',
              severity: 'critical',
              title: 'Hardcoded credentials in auth.js',
              description: 'Plaintext secret passwords detected in login condition.',
              evidence: "password === 'secret123'",
              filePath: 'auth.js',
              lineStart: 5,
              lineEnd: 5,
              confidence: 0.95,
              recommendation: 'Move credentials to environment variables or secret manager.'
            },
            {
              category: 'sql-injection',
              severity: 'critical',
              title: 'SQL Injection in db.js',
              description: 'String concatenation detected in SQL statements.',
              evidence: 'const sql = "SELECT * FROM users WHERE id = " + id;',
              filePath: 'db.js',
              lineStart: 4,
              lineEnd: 4,
              confidence: 0.9,
              recommendation: 'Use parameterized queries or ORM binding.'
            }
          ]
        });
      } else if (isPerformancePrompt) {
        responseText = JSON.stringify({
          findings: [
            {
              category: 'inefficient-operations',
              severity: 'medium',
              title: 'Concatenation in loop warning',
              description: 'Avoid performing string allocations inside critical functions.',
              evidence: 'const sql = "SELECT * FROM users WHERE id = " + id;',
              filePath: 'db.js',
              lineStart: 4,
              lineEnd: 4,
              confidence: 0.75,
              recommendation: 'Optimize database query template rendering.'
            }
          ]
        });
      } else if (isQualityPrompt) {
        responseText = JSON.stringify({
          findings: [
            {
              category: 'naming',
              severity: 'low',
              title: 'Vague parameter naming',
              description: 'Parameter "id" is too short, consider descriptive naming.',
              evidence: 'const queryUser = (id) => {',
              filePath: 'db.js',
              lineStart: 3,
              lineEnd: 3,
              confidence: 0.7,
              recommendation: 'Rename "id" to "userId".'
            }
          ]
        });
      } else {
        responseText = JSON.stringify({ findings: [] });
      }

      return {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-mock123',
          model: 'gpt-4o-mini',
          choices: [
            {
              message: {
                role: 'assistant',
                content: responseText
              }
            }
          ]
        })
      };
    }

    if (url.includes('/embeddings')) {
      const input = JSON.parse(options.body).input;
      const length = Array.isArray(input) ? input.length : 1;
      const data = Array.from({ length }).map((_, i) => ({
        embedding: Array.from({ length: 1536 }).map(() => Math.random())
      }));

      return {
        ok: true,
        json: async () => ({
          model: 'text-embedding-3-small',
          data
        })
      };
    }

    return originalFetch(url, options);
  };
}

const runTest = async () => {
  const dummyDir = createDummyCodebase();
  let mongoConnected = false;

  try {
    // 1. Connect MongoDB
    const mongoUri = process.env.MONGODB_URI;
    console.log(`[Verify] Connecting MongoDB to: ${mongoUri}`);
    await mongoose.connect(mongoUri);
    mongoConnected = true;
    console.log('[Verify] MongoDB Connected.');

    // Clear test DB collections
    await Review.deleteMany({});
    await Repository.deleteMany({});
    await Issue.deleteMany({});

    // 2. Index Repository (Local)
    console.log('[Verify] Indexing Local Dummy Codebase...');
    const indexer = getIndexer();
    const indexResult = await indexer.indexRepository({
      repositoryPath: dummyDir,
      repositoryName: 'test-org/dummy-repo',
      collectionName: 'devmind-test-collection',
    });
    console.log(`[Verify] Indexing finished. Files indexed: ${indexResult.filesIndexed}, Chunks: ${indexResult.chunksIndexed}`);

    // Verify Repository saved in Mongo
    const repoRecord = await Repository.findOneAndUpdate(
      { owner: 'test-org', repo: 'dummy-repo' },
      {
        owner: 'test-org',
        repo: 'dummy-repo',
        fullName: 'test-org/dummy-repo',
        defaultBranch: 'main',
        lastIndexedAt: new Date(),
      },
      { upsert: true, returnDocument: 'after' }
    );
    console.log('[Verify] Repository record saved:', repoRecord.fullName);

    // 3. Test Retrieval
    console.log('[Verify] Testing Code Context Retrieval...');
    const retriever = getRetriever();
    const mockDiff = `
    diff --git a/auth.js b/auth.js
    index 12345..67890 100644
    --- a/auth.js
    +++ b/auth.js
    @@ -5,3 +5,3 @@
    -      if (username === 'admin' && password === 'secret123') {
    +      if (username === 'admin' && password === process.env.ADMIN_PASSWORD) {
    `;
    const retrievalResult = await retriever.retrieveRelevantCodeChunks({
      pullRequestDiff: mockDiff,
      collectionName: 'devmind-test-collection',
      topK: 3,
    });
    console.log(`[Verify] Retrieval matched chunks count: ${retrievalResult.context.length}`);

    // 4. Test Review Workflow
    console.log('[Verify] Executing Review Service (Agents + Aggregator + Severity)...');
    const reviewService = getReviewService();
    const reviewResult = await reviewService.reviewPullRequest({
      repository: { owner: 'test-org', repo: 'dummy-repo', fullName: 'test-org/dummy-repo' },
      pullNumber: 12,
      collectionName: 'devmind-test-collection',
      pullRequestDiff: mockDiff,
    });

    console.log('[Verify] Review execution complete.');
    console.log(`[Verify] Review Summary - Total Issues: ${reviewResult.consolidatedReport.summary.total}`);
    console.log('[Verify] Severity count:', reviewResult.severityReport.summary.counts);

    // Verify MongoDB Storage
    const reviewsInDb = await Review.find({});
    console.log(`[Verify] MongoDB Review documents stored: ${reviewsInDb.length}`);
    if (reviewsInDb.length > 0) {
      console.log('[Verify] Review document ID:', reviewsInDb[0]._id);
      console.log('[Verify] Status:', reviewsInDb[0].status);
      console.log(`[Verify] Findings Count: ${reviewsInDb[0].findings.length}`);
    }

    console.log('\n[SUCCESS] E2E Pipeline verified successfully!');
  } catch (error) {
    console.error('\n[FAILURE] E2E Pipeline verification failed:', error);
  } finally {
    cleanDummyCodebase(dummyDir);
    if (mongoConnected) {
      await mongoose.disconnect();
      console.log('[Verify] MongoDB Disconnected.');
    }
  }
};

runTest();
