import Anthropic from '@anthropic-ai/sdk'
import prisma from '../db/prisma'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function generateCoverLetter(
  userId: string,
  jobId: string
): Promise<string> {
  // Get user CV
  const cv = await prisma.cV.findUnique({
    where: { userId },
    include: { user: true },
  })

  if (!cv) return 'Please upload your CV first before generating a cover letter.'

  // Get job details
  const job = await prisma.job.findUnique({
    where: { id: jobId },
  })

  if (!job) return 'Job not found.'

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `Write a professional cover letter for a Nigerian job applicant.

APPLICANT PROFILE:
Name: ${cv.user.name || 'Applicant'}
Current Role: ${cv.currentRole || 'Professional'}
Experience: ${cv.experience} years
Skills: ${cv.skills.join(', ')}
Location: ${cv.location || 'Lagos'}
Education: ${cv.education || 'Not specified'}
Summary: ${cv.summary}

JOB DETAILS:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Sector: ${job.sector}
Required Skills: ${job.skills.join(', ')}
Salary: ${job.salary || 'Not specified'}

Write a compelling, professional cover letter that:
- Opens strongly and mentions the specific role
- Highlights 2-3 most relevant skills and achievements
- Shows knowledge of the Nigerian market context
- Is confident but not arrogant
- Ends with a clear call to action
- Is between 250-350 words
- Feels human and genuine, not generic

Return only the cover letter text, no subject line, no extra commentary.`
      }
    ]
  })

  const content = response.content[0]
  if (content.type !== 'text') return 'Could not generate cover letter.'

  return content.text
}