import Anthropic from '@anthropic-ai/sdk'
import { getDB } from '../db/prisma'

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

  const cv = await prisma.cV.findUnique({
    where: { userId },
  })

  if (!cv) return []

  const existingMatchIds = await prisma.jobMatch.findMany({
    where: { userId },
    select: { jobId: true },
  })

  const excludeIds = existingMatchIds.map((m) => m.jobId)

  // ─────────────────────────────────────────────
  // STEP 1: Pre-filter in Prisma — no Claude yet
  // Goal: get 15 relevant jobs using data we already have
  // ─────────────────────────────────────────────

  const userSectors = (cv.sectors || []).map((s) => s.toLowerCase())
  const userLocation = cv.location?.toLowerCase() || ''
  const userSkills = (cv.skills || []).map((s) => s.toLowerCase())

  const tradeKeywords = [
    'electrician', 'plumber', 'welder', 'mechanic', 'carpenter',
    'tailor', 'driver', 'cook', 'chef', 'cleaner', 'security', 'mason',
  ]

  const isTechProfessional =
    userSectors.some((s) =>
      ['tech', 'finance', 'banking', 'fintech', 'oil', 'gas'].includes(s)
    ) ||
    [
      'engineer', 'developer', 'analyst', 'manager', 'designer',
      'accountant', 'lawyer', 'consultant', 'officer', 'coordinator', 'executive',
    ].some((k) => (cv.currentRole?.toLowerCase() || '').includes(k))

  // Build a priority-ordered list of candidate jobs from DB
  // Round 1: same sector AND same location (best matches)
  // Round 2: same sector only
  // Round 3: recent jobs that are not trade roles (fallback)

  let jobs: Awaited<ReturnType<typeof prisma.job.findMany>> = []

  const baseWhere = {
    isActive: true,
    id: { notIn: excludeIds },
    ...(isTechProfessional
      ? {
          NOT: {
            OR: tradeKeywords.map((t) => ({
              title: { contains: t, mode: 'insensitive' as const },
            })),
          },
        }
      : {}),
  }

  // Round 1 — sector + location match
  if (userSectors.length > 0 && userLocation) {
    const round1 = await prisma.job.findMany({
      where: {
        ...baseWhere,
        sector: { in: cv.sectors, mode: 'insensitive' },
        location: { contains: userLocation, mode: 'insensitive' },
      },
      orderBy: { postedAt: 'desc' },
      take: 10,
    })
    jobs = round1
  }

  // Round 2 — sector match only (if round 1 gave us fewer than 10)
  if (jobs.length < 10 && userSectors.length > 0) {
    const existingIds = new Set(jobs.map((j) => j.id))
    const round2 = await prisma.job.findMany({
      where: {
        ...baseWhere,
        id: { notIn: [...excludeIds, ...Array.from(existingIds)] },
        sector: { in: cv.sectors, mode: 'insensitive' },
      },
      orderBy: { postedAt: 'desc' },
      take: 10 - jobs.length,
    })
    jobs = [...jobs, ...round2]
  }

  // Round 3 — recent jobs as fallback (if still fewer than 10)
  if (jobs.length < 10) {
    const existingIds = new Set(jobs.map((j) => j.id))
    const round3 = await prisma.job.findMany({
      where: {
        ...baseWhere,
        id: { notIn: [...excludeIds, ...Array.from(existingIds)] },
      },
      orderBy: { postedAt: 'desc' },
      take: 15 - jobs.length,
    })
    jobs = [...jobs, ...round3]
  }

  if (jobs.length === 0) return []

  console.log(`Pre-filtered to ${jobs.length} jobs for Claude (was 50)`)

  // ─────────────────────────────────────────────
  // STEP 2: Send pre-filtered jobs to Claude
  // Now only ~10-15 jobs instead of 50
  // ─────────────────────────────────────────────

  const cvSummary = `
Role: ${cv.currentRole || 'Not specified'}
Experience: ${cv.experience} years
Skills: ${cv.skills.join(', ')}
Location: ${cv.location || 'Lagos'}
Sectors: ${cv.sectors.join(', ')}
Salary range: ₦${cv.salaryMin?.toLocaleString() || '?'} - ₦${cv.salaryMax?.toLocaleString() || '?'}
Education: ${cv.education || 'Not specified'}
  `.trim()

  const jobsList = jobs
    .map(
      (job, index) => `
Job ${index + 1}:
ID: ${job.id}
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Sector: ${job.sector}
Skills: ${job.skills.join(', ')}
Salary: ${job.salary || 'Not specified'}
Description: ${job.description.slice(0, 150)}
    `.trim()
    )
    .join('\n\n')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: `You are a job matching engine for the Nigerian job market.

CANDIDATE:
${cvSummary}

JOBS:
${jobsList}

Score each job 0 to 1. Be practical — related roles count (e.g. Data Analyst can match Data Engineer, BI Analyst, IT roles).
Do NOT match completely unrelated roles (Nurse, Driver, Cook, etc.).

Scores:
- 0.8-1.0: Strong match
- 0.6-0.79: Good match
- 0.5-0.59: Possible match

Return ONLY a valid JSON array, no markdown, no backticks:
[{"jobId":"id","score":0.87,"reasons":["reason1","reason2"]}]

Only jobs with score >= 0.5. Maximum 5. If none qualify return [].`,
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') return []

  try {
    const cleaned = content.text.replace(/```json|```/g, '').trim()
    console.log('Claude matching response:', cleaned.slice(0, 500))
    const matches: JobMatch[] = JSON.parse(cleaned)

    const goodMatches = matches.filter((m) => m.score >= 0.5)
    console.log(`Matches found: ${goodMatches.length}`)

    // Save matches to DB
    for (const match of goodMatches) {
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

    return goodMatches
  } catch (error) {
    console.error('Job matching parse error:', error)
    return []
  }
}