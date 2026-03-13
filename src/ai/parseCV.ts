import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface CVData {
  skills: string[]
  experience: number
  currentRole: string | null
  location: string | null
  sectors: string[]
  salaryMin: number | null
  salaryMax: number | null
  education: string | null
  summary: string
}

export async function extractCVData(rawText: string): Promise<CVData> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `You are a CV parser. Extract structured data from this CV text and return ONLY a valid JSON object with no extra text, no markdown, no backticks.

CV TEXT:
${rawText.slice(0, 3000)}

Return this exact JSON structure:
{
  "skills": ["skill1", "skill2"],
  "experience": 3,
  "currentRole": "Software Engineer",
  "location": "Lagos",
  "sectors": ["Tech", "Fintech"],
  "salaryMin": 300000,
  "salaryMax": 500000,
  "education": "BSc Computer Science, University of Lagos",
  "summary": "2-3 sentence professional summary"
}

Rules:
- skills: array of technical and soft skills found in CV (max 15)
- experience: total years of work experience as a number
- currentRole: most recent job title
- location: city in Nigeria or "Remote" if not clear
- sectors: pick from [Tech, Fintech, Banking, Oil & Gas, Telecoms, Sales, Marketing, Finance, HR, Operations, NGO] — max 3
- salaryMin/salaryMax: expected salary in NGN based on role and experience (estimate if not stated)
- education: highest qualification and institution
- summary: brief professional summary based on CV
- Return ONLY the JSON, nothing else`
      }
    ]
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')

  try {
    const cleaned = content.text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      skills: parsed.skills || [],
      experience: parsed.experience || 0,
      currentRole: parsed.currentRole || null,
      location: parsed.location || null,
      sectors: parsed.sectors || [],
      salaryMin: parsed.salaryMin || null,
      salaryMax: parsed.salaryMax || null,
      education: parsed.education || null,
      summary: parsed.summary || '',
    }
  } catch (error) {
    console.error('CV parse error:', error)
    // Return safe defaults if parsing fails
    return {
      skills: [],
      experience: 0,
      currentRole: null,
      location: 'Lagos',
      sectors: ['Tech'],
      salaryMin: null,
      salaryMax: null,
      education: null,
      summary: '',
    }
  }
}