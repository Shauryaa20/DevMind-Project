const { ChromaClient } = require('chromadb');

const createChromaClient = () => {
  const chromaUrl = process.env.CHROMA_URL;

  if (!chromaUrl) {
    throw new Error('CHROMA_URL is not set.');
  }

  const parsedUrl = chromaUrl.startsWith('http://') || chromaUrl.startsWith('https://')
    ? new URL(chromaUrl)
    : new URL(`http://${chromaUrl}`);

  return new ChromaClient({
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80)),
    ssl: parsedUrl.protocol === 'https:',
  });
};

module.exports = { createChromaClient };
