import Anthropic from '@anthropic-ai/sdk'
import prisma from '../db/prisma'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface JobMatch {
  jobId: string
  score: number
  reasons: string[]
}

export async function matchJobsToUser(userId: string): Promise<JobMatch[]> {
  const cv = await prisma.cV.findUnique({
    where: { userId },
  })

  if (!cv) return []

  const existingMatchIds = await prisma.jobMatch.findMany({
    where: { userId },
    select: { jobId: true },
  })

  const excludeIds = existingMatchIds.map((m) => m.jobId)

  const userSectors = cv.sectors || []
  const userRole = cv.currentRole?.toLowerCase() || ''

  // Determine if user is a tech/professional worker
  const techKeywords = ['engineer', 'developer', 'analyst', 'manager', 'designer', 
    'accountant', 'lawyer', 'consultant', 'officer', 'coordinator', 'executive']
  const isTechProfessional = techKeywords.some(k => userRole.includes(k)) || 
    userSectors.some(s => ['tech', 'finance', 'banking', 'fintech', 'oil', 'gas'].includes(s.toLowerCase()))

  const tradeKeywords = ['electrician', 'plumber', 'welder', 'mechanic', 'carpenter', 
    'tailor', 'driver', 'cook', 'chef', 'cleaner', 'security', 'mason']
  const isTradeProfessional = tradeKeywords.some(k => userRole.includes(k))

  const jobs = await prisma.job.findMany({
    where: {
      isActive: true,
      id: { notIn: excludeIds },
      ...(isTechProfessional && !isTradeProfessional ? {
        NOT: {
          OR: tradeKeywords.map(title => ({
            title: { contains: title, mode: 'insensitive' }
          }))
        }
      } : {})
    },
    orderBy: { postedAt: 'desc' },
    take: 50,
  })

  if (jobs.length === 0) return []

  const cvSummary = `
Role: ${cv.currentRole || 'Not specified'}
Experience: ${cv.experience} years
Skills: ${cv.skills.join(', ')}
Location: ${cv.location || 'Lagos'}
Sectors: ${cv.sectors.join(', ')}
Salary range: ₦${cv.salaryMin?.toLocaleString() || '?'} - ₦${cv.salaryMax?.toLocaleString() || '?'}
Education: ${cv.education || 'Not specified'}
  `.trim()

  const jobsList = jobs.map((job, index) => `
Job ${index + 1}:
ID: ${job.id}
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Sector: ${job.sector}
Skills required: ${job.skills.join(', ')}
Salary: ${job.salary || 'Not specified'}
Description: ${job.description.slice(0, 200)}
  `.trim()).join('\n\n')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `You are a job matching engine for the Nigerian job market.

CANDIDATE PROFILE:
${cvSummary}

AVAILABLE JOBS:
${jobsList}

INSTRUCTIONS:
Match the candidate to the most relevant jobs from the list above.
Be practical — a Data Analyst can apply for Data Engineer, BI Analyst, Data Processor, Dashboard Operations, Product Analyst, IT roles, and similar tech-adjacent roles.
A Software Developer can apply for Frontend, Backend, Fullstack, DevOps, and tech-adjacent roles.
General sector jobs can still match if the job title is relevant to the candidate.
Do NOT match completely unrelated roles like Dentist, Driver, Teacher, Cook, Nurse, or purely physical/manual jobs.
Be generous — it is better to show a 55% match than to show nothing at all.

Score each job from 0 to 1:
- 0.8-1.0: Strong match — title and skills align closely
- 0.6-0.79: Good match — related role, most skills transfer
- 0.5-0.59: Possible match — different title but skills clearly apply

Return ONLY a valid JSON array, no markdown, no explanation, no backticks:
[
  {
    "jobId": "actual_job_id_from_list",
    "score": 0.87,
    "reasons": ["Role matches candidate's experience", "SQL and Python skills align", "Lagos location"]
  }
]

Only include jobs with score 0.5 and above.
Maximum 5 jobs.
If truly no jobs are relevant, return: []
Return ONLY the JSON array, nothing else.`
      }
    ]
  })

  const content = response.content[0]
  if (content.type !== 'text') return []

  try {
    const cleaned = content.text.replace(/```json|```/g, '').trim()
    console.log('Claude matching response:', cleaned.slice(0, 500))
    const matches: JobMatch[] = JSON.parse(cleaned)
    console.log('Matches found:', matches.length)

    const goodMatches = matches.filter(m => m.score >= 0.5)

    for (const match of goodMatches) {
      await prisma.jobMatch.upsert({
        where: {
          userId_jobId: {
            userId,
            jobId: match.jobId,
          },
        },
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
    console.error('Job matching error:', error)
    return []
  }
}