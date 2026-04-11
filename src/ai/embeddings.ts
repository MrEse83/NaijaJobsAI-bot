import { OpenAIEmbeddings } from '@langchain/openai'
import { getDB } from '../db/prisma'

// ─────────────────────────────────────────────
// OpenAI embeddings client
// Using text-embedding-3-small — cheap and accurate
// Cost: ~$0.00002 per 1000 tokens
// ─────────────────────────────────────────────
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',
})

// ─────────────────────────────────────────────
// Generate embedding for any text
// Returns a vector of 1536 dimensions
// ─────────────────────────────────────────────
export async function generateEmbedding(text: string): Promise<number[]> {
  const vector = await embeddings.embedQuery(text)
  return vector
}

// ─────────────────────────────────────────────
// Cosine similarity between two vectors
// Returns 0 to 1 (1 = identical, 0 = unrelated)
// ─────────────────────────────────────────────
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  if (magnitudeA === 0 || magnitudeB === 0) return 0
  return dotProduct / (magnitudeA * magnitudeB)
}

// ─────────────────────────────────────────────
// Build CV text for embedding
// Combines all relevant CV fields into one rich string
// ─────────────────────────────────────────────
export function buildCVText(cv: {
  currentRole: string | null
  skills: string[]
  experience: number
  location: string | null
  sectors: string[]
  education: string | null
  summary: string | null
}): string {
  return `
Role: ${cv.currentRole || ''}
Skills: ${cv.skills.join(', ')}
Experience: ${cv.experience} years
Location: ${cv.location || ''}
Sectors: ${cv.sectors.join(', ')}
Education: ${cv.education || ''}
Summary: ${cv.summary || ''}
  `.trim()
}

// ─────────────────────────────────────────────
// Build Job text for embedding
// ─────────────────────────────────────────────
export function buildJobText(job: {
  title: string
  company: string
  location: string
  sector: string
  skills: string[]
  description: string
  salary: string | null
}): string {
  return `
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Sector: ${job.sector}
Skills: ${job.skills.join(', ')}
Salary: ${job.salary || ''}
Description: ${job.description.slice(0, 300)}
  `.trim()
}

// ─────────────────────────────────────────────
// Embed a CV and save to DB
// Called after CV is parsed and saved
// ─────────────────────────────────────────────
export async function embedCV(userId: string): Promise<void> {
  const prisma = getDB()

  const cv = await prisma.cV.findUnique({ where: { userId } })
  if (!cv) return

  const text = buildCVText(cv)
  const vector = await generateEmbedding(text)

  await prisma.cV.update({
    where: { userId },
    data: { embedding: vector },
  })

  console.log(`✅ CV embedded for user ${userId}`)
}

// ─────────────────────────────────────────────
// Embed a Job and save to DB
// Called after job is scraped and saved
// ─────────────────────────────────────────────
export async function embedJob(jobId: string): Promise<void> {
  const prisma = getDB()

  const job = await prisma.job.findUnique({ where: { id: jobId } })
  if (!job) return

  const text = buildJobText(job)
  const vector = await generateEmbedding(text)

  await prisma.job.update({
    where: { id: jobId },
    data: { embedding: vector },
  })
}

// ─────────────────────────────────────────────
// Find top matching jobs for a CV using vectors
// Returns jobs sorted by cosine similarity score
// ─────────────────────────────────────────────
export async function findSimilarJobs(
  userId: string,
  limit: number = 10
): Promise<{ jobId: string; score: number }[]> {
  const prisma = getDB()

  // Get CV embedding
  const cv = await prisma.cV.findUnique({ where: { userId } })
  if (!cv || !cv.embedding || cv.embedding.length === 0) return []

  // Get already matched job IDs
  const existingMatches = await prisma.jobMatch.findMany({
    where: { userId },
    select: { jobId: true },
  })
  const excludeIds = existingMatches.map((m) => m.jobId)

  // Get all active jobs that have embeddings
  const jobs = await prisma.job.findMany({
    where: {
      isActive: true,
      id: { notIn: excludeIds },
      NOT: { embedding: { equals: [] } },
    },
    select: {
      id: true,
      embedding: true,
    },
    orderBy: { postedAt: 'desc' },
    take: 500, // compare against latest 500 jobs
  })

  if (jobs.length === 0) return []

  // Calculate cosine similarity for each job
  const scored = jobs
    .filter((j) => j.embedding && j.embedding.length > 0)
    .map((job) => ({
      jobId: job.id,
      score: cosineSimilarity(cv.embedding as number[], job.embedding as number[]),
    }))
    .filter((j) => j.score >= 0.4) // minimum similarity threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scored
}