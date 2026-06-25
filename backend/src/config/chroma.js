const { ChromaClient } = require('chromadb');

const createChromaClient = () => {
  const chromaUrl = process.env.CHROMA_URL;

  if (!chromaUrl) {
    throw new Error('CHROMA_URL is not set.');
  }

  const parsedUrl = chromaUrl.startsWith('http://') || chromaUrl.startsWith('https://')
    ? new URL(chromaUrl)
    : new URL(`http://${chromaUrl}`);

  const host = parsedUrl.hostname;
  const port = Number(parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80));
  const ssl = parsedUrl.protocol === 'https:';

  console.log(`[Chroma Diagnostic] Instantiating ChromaClient with host: "${host}", port: ${port}, ssl: ${ssl}`);

  return new ChromaClient({
    host,
    port,
    ssl,
  });
};

module.exports = { createChromaClient };

