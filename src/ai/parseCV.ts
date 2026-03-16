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

const VALID_SECTORS = [
  'Tech', 'Fintech', 'Banking', 'Oil & Gas', 'Telecoms',
  'Sales', 'Marketing', 'Finance', 'HR', 'Operations', 'NGO',
]

// ─────────────────────────────────────────────
// Validate and sanitise the parsed JSON
// so even a partially correct response is usable
// ─────────────────────────────────────────────
function sanitiseParsed(parsed: any): CVData {
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.filter((s: any) => typeof s === 'string').slice(0, 15)
    : []

  const experience =
    typeof parsed.experience === 'number' && parsed.experience >= 0
      ? Math.round(parsed.experience)
      : 0

  const sectors = Array.isArray(parsed.sectors)
    ? parsed.sectors.filter((s: any) => VALID_SECTORS.includes(s)).slice(0, 3)
    : []

  return {
    skills,
    experience,
    currentRole: typeof parsed.currentRole === 'string' ? parsed.currentRole : null,
    location: typeof parsed.location === 'string' ? parsed.location : null,
    sectors,
    salaryMin: typeof parsed.salaryMin === 'number' ? parsed.salaryMin : null,
    salaryMax: typeof parsed.salaryMax === 'number' ? parsed.salaryMax : null,
    education: typeof parsed.education === 'string' ? parsed.education : null,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}

function tryParseJSON(text: string): CVData | null {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const result = sanitiseParsed(parsed)

    // Must have at least a role or skills to be considered valid
    if (!result.currentRole && result.skills.length === 0) return null

    return result
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────
export async function extractCVData(rawText: string): Promise<CVData> {
  const cvText = rawText.slice(0, 3000)

  // ── Attempt 1: standard prompt ──
  const attempt1 = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `You are a CV parser. Extract structured data from this CV text and return ONLY a valid JSON object with no extra text, no markdown, no backticks.

CV TEXT:
${cvText}

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
- Return ONLY the JSON, nothing else`,
      },
    ],
  })

  const content1 = attempt1.content[0]
  if (content1.type === 'text') {
    const result = tryParseJSON(content1.text)
    if (result) {
      console.log('✅ CV parsed successfully on attempt 1')
      return result
    }
    console.warn('⚠️ Attempt 1 returned invalid JSON, retrying...')
    console.warn('Raw response:', content1.text.slice(0, 200))
  }

  // ── Attempt 2: stricter, simpler prompt ──
  const attempt2 = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `Extract data from this CV. You MUST respond with ONLY a raw JSON object.
Do NOT include any text before or after the JSON.
Do NOT use markdown or code blocks.
Start your response with { and end with }.

CV:
${cvText}

JSON format (use null for missing fields):
{"skills":["skill1"],"experience":2,"currentRole":"Job Title","location":"Lagos","sectors":["Tech"],"salaryMin":200000,"salaryMax":400000,"education":"Degree, School","summary":"One sentence summary."}`,
      },
    ],
  })

  const content2 = attempt2.content[0]
  if (content2.type === 'text') {
    const result = tryParseJSON(content2.text)
    if (result) {
      console.log('✅ CV parsed successfully on attempt 2')
      return result
    }
    console.error('❌ Attempt 2 also returned invalid JSON')
    console.error('Raw response:', content2.text.slice(0, 200))
  }

  // ── Both attempts failed — throw so cv.ts can inform the user ──
  throw new Error('CV parsing failed after 2 attempts — could not extract structured data')
}