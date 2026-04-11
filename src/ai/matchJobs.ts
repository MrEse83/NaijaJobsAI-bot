import Anthropic from '@anthropic-ai/sdk'
import { getDB } from '../db/prisma'
import { findSimilarJobs } from './embeddings'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface JobMatch {
  jobId: string
  score: number
  reasons: string[]
}

export async function matchJobsToUser(userId: string): Promise<JobMatch[]> {
  const prisma = getDB()

  const cv = await prisma.cV.findUnique({ where: { userId } })
  if (!cv) return []

  // ─────────────────────────────────────────────
  // STEP 1: Vector similarity search
  // Fast, cheap, accurate — no Claude needed for scoring
  // ─────────────────────────────────────────────
  const hasEmbedding = cv.embedding && (cv.embedding as number[]).length > 0

  let topMatches: { jobId: string; score: number }[] = []

  if (hasEmbedding) {
    console.log('Using vector similarity matching...')
    topMatches = await findSimilarJobs(userId, 10)
    console.log(`Vector search found ${topMatches.length} candidates`)
  }

  // Fallback to keyword matching if no embeddings yet
  if (topMatches.length === 0) {
    console.log('No embeddings found, falling back to keyword matching...')
    topMatches = await keywordFallback(userId, cv)
  }

  if (topMatches.length === 0) return []

  // ─────────────────────────────────────────────
  // STEP 2: Fetch full job details for top matches
  // ─────────────────────────────────────────────
  const jobIds = topMatches.map((m) => m.jobId)
  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds } },
  })

  const jobMap = new Map(jobs.map((j) => [j.id, j]))

  // ─────────────────────────────────────────────
  // STEP 3: Use Claude ONLY to generate reasons
  // Not for scoring — just explaining the match
  // ─────────────────────────────────────────────
  const cvSummary = `
Role: ${cv.currentRole || 'Not specified'}
Experience: ${cv.experience} years
Skills: ${cv.skills.join(', ')}
Location: ${cv.location || 'Lagos'}
Sectors: ${cv.sectors.join(', ')}
  `.trim()

  const topJobsList = topMatches.slice(0, 5).map((match) => {
    const job = jobMap.get(match.jobId)
    if (!job) return null
    return {
      jobId: match.jobId,
      score: match.score,
      title: job.title,
      company: job.company,
      skills: job.skills,
      location: job.location,
    }
  }).filter(Boolean)

  if (topJobsList.length === 0) return []

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: `You are a career advisor for Nigerian job seekers.

CANDIDATE:
${cvSummary}

TOP MATCHED JOBS (already scored by AI):
${topJobsList.map((j, i) => `${i + 1}. ${j!.title} at ${j!.company} (${j!.location}) — Skills: ${j!.skills.join(', ')}`).join('\n')}

For each job, write 2 short reasons (max 8 words each) why this candidate matches.
Be specific — mention actual skills or experience.

Return ONLY valid JSON, no markdown:
[{"jobId":"id","reasons":["reason1","reason2"]}]`,
      },
    ],
  })

  const content = response.content[0]
  let reasonsMap = new Map<string, string[]>()

  if (content.type === 'text') {
    try {
      const cleaned = content.text.replace(/```json|```/g, '').trim()
      const parsed: { jobId: string; reasons: string[] }[] = JSON.parse(cleaned)
      parsed.forEach((p) => reasonsMap.set(p.jobId, p.reasons))
    } catch {
      console.warn('Could not parse Claude reasons — using defaults')
    }
  }

  // ─────────────────────────────────────────────
  // STEP 4: Build final matches and save to DB
  // ─────────────────────────────────────────────
  const finalMatches: JobMatch[] = topMatches.slice(0, 5).map((match) => {
    const job = jobMap.get(match.jobId)
    const reasons = reasonsMap.get(match.jobId) || [
      `${Math.round(match.score * 100)}% skill alignment`,
      job ? `${job.location} location match` : 'Good profile match',
    ]

    return {
      jobId: match.jobId,
      score: Math.min(match.score, 1),
      reasons,
    }
  }).filter((m) => jobMap.has(m.jobId))

  for (const match of finalMatches) {
    await prisma.jobMatch.upsert({
      where: { userId_jobId: { userId, jobId: match.jobId } },
      create: {
        userId,
        jobId: match.jobId,
        score: match.score,
        reasons: match.reasons,
      },
      update: {
        score: match.score,
        reasons: match.reasons,
      },
    })
  }

  console.log(`✅ Matched ${finalMatches.length} jobs for user ${userId}`)
  return finalMatches
}

// ─────────────────────────────────────────────
// Keyword fallback — used when no embeddings exist yet
// ─────────────────────────────────────────────
async function keywordFallback(
  userId: string,
  cv: any
): Promise<{ jobId: string; score: number }[]> {
  const prisma = getDB()

  const existingMatchIds = await prisma.jobMatch.findMany({
    where: { userId },
    select: { jobId: true },
  })
  const excludeIds = existingMatchIds.map((m) => m.jobId)

  const tradeKeywords = [
    'electrician', 'plumber', 'welder', 'mechanic', 'carpenter',
    'tailor', 'driver', 'cook', 'chef', 'cleaner', 'security', 'mason',
  ]

  const userRole = cv.currentRole?.toLowerCase() || ''
  const isTechProfessional =
    (cv.sectors || []).some((s: string) =>
      ['tech', 'finance', 'banking', 'fintech', 'oil', 'gas'].includes(s.toLowerCase())
    ) ||
    ['engineer', 'developer', 'analyst', 'manager', 'designer',
      'accountant', 'lawyer', 'consultant', 'officer', 'coordinator', 'executive',
    ].some((k) => userRole.includes(k))

  const jobs = await prisma.job.findMany({
    where: {
      isActive: true,
      id: { notIn: excludeIds },
      ...(cv.sectors?.length > 0 ? {
        sector: { in: cv.sectors, mode: 'insensitive' as const },
      } : {}),
      ...(isTechProfessional ? {
        NOT: {
          OR: tradeKeywords.map((t) => ({
            title: { contains: t, mode: 'insensitive' as const },
          })),
        },
      } : {}),
    },
    orderBy: { postedAt: 'desc' },
    take: 10,
    select: { id: true },
  })

  return jobs.map((j) => ({ jobId: j.id, score: 0.6 }))
}