import OpenAI from 'openai'
import { Chunk } from './chunker'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const EMBEDDING_MODEL = 'text-embedding-3-large'
const EMBEDDING_DIMENSION = 1024 // Using 1024 dimensions (within pgvector 2000 limit)
const BATCH_SIZE = 50 // Number of texts to embed in one batch

/**
 * Generate embeddings for text chunks using OpenAI
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const embeddings: number[][] = []

  // Process in batches to avoid rate limits
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMENSION,
      })

      const batchEmbeddings = response.data.map(item => item.embedding)
      embeddings.push(...batchEmbeddings)
    } catch (error) {
      console.error(`Error generating embeddings for batch ${i}:`, error)
      throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return embeddings
}

/**
 * Generate embedding for a single query text
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([query])
  return embeddings[0]
}

/**
 * Generate embeddings for chunks
 */
export async function generateChunkEmbeddings(chunks: Chunk[]): Promise<number[][]> {
  const texts = chunks.map(chunk => chunk.chunk_text)
  return generateEmbeddings(texts)
}

/**
 * Get the embedding dimension for the configured model
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSION
}

