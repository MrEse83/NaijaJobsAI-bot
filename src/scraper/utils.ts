// ─────────────────────────────────────────────
// Shared utilities for all scrapers
// ─────────────────────────────────────────────

export const NIGERIAN_CITIES = [
  'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan',
  'Kaduna', 'Enugu', 'Benin City', 'Warri', 'Calabar',
  'Owerri', 'Uyo', 'Jos', 'Ilorin', 'Abeokuta', 'Remote',
]

export function detectLocation(text: string): string {
  if (!text) return 'Nigeria'
  const textLower = text.toLowerCase()
  for (const city of NIGERIAN_CITIES) {
    if (textLower.includes(city.toLowerCase())) return city
  }
  if (textLower.includes('ph') || textLower.includes('rivers')) return 'Port Harcourt'
  if (textLower.includes('fct')) return 'Abuja'
  if (textLower.includes('remote') || textLower.includes('hybrid')) return 'Remote'
  return 'Nigeria'
}

export function detectSector(title: string): string {
  const t = title.toLowerCase()
  if (
    t.includes('data') || t.includes('analyst') ||
    t.includes('software') || t.includes('developer') ||
    t.includes('engineer') || t.includes('product manager') ||
    t.includes('devops') || t.includes('frontend') ||
    t.includes('backend') || t.includes('fullstack') ||
    t.includes('full-stack') || t.includes('it support') ||
    t.includes('ict') || t.includes('cybersecurity') ||
    t.includes('cloud') || t.includes('machine learning') ||
    t.includes('ai ')
  ) return 'Tech'
  if (
    t.includes('bank') || t.includes('finance') ||
    t.includes('account') || t.includes('audit') ||
    t.includes('credit') || t.includes('loan') ||
    t.includes('investment') || t.includes('insurance')
  ) return 'Banking'
  if (
    t.includes('oil') || t.includes('gas') ||
    t.includes('petroleum') || t.includes('drilling')
  ) return 'Oil & Gas'
  if (
    t.includes('sales') || t.includes('marketing') ||
    t.includes('business dev') || t.includes('acquisition') ||
    t.includes('growth') || t.includes('brand')
  ) return 'Sales'
  return 'General'
}

export function extractSkills(text: string): string[] {
  const keywords = [
    'JavaScript', 'TypeScript', 'Python', 'React', 'Node.js',
    'SQL', 'MongoDB', 'AWS', 'DevOps', 'Docker', 'Java', 'PHP',
    'Laravel', 'Django', 'Flutter', 'Data Analysis', 'Excel',
    'PowerBI', 'Tableau', 'Sales', 'Marketing', 'Finance',
    'Accounting', 'Project Management', 'Agile', 'Scrum',
  ]
  const textLower = text.toLowerCase()
  return keywords.filter((k) => textLower.includes(k.toLowerCase()))
}

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox']

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─────────────────────────────────────────────
// Shared upsert — deduplicates by title + company
// If a job already exists from another source,
// we update it instead of creating a duplicate
// ─────────────────────────────────────────────
interface UpsertJobParams {
  title: string
  company: string
  location: string
  sector: string
  source: string
  sourceUrl: string
  salary: string | null
  description: string
  skills: string[]
}

export async function upsertJob(params: UpsertJobParams): Promise<void> {
  const { getDB } = await import('../db/prisma')
  const prisma = getDB()

  // Check if job already exists by title + company (cross-source duplicate)
  const existing = await prisma.job.findFirst({
    where: {
      title: { equals: params.title, mode: 'insensitive' },
      company: { equals: params.company, mode: 'insensitive' },
    },
  })

  if (existing) {
    // Job already exists — just update active status and salary
    // Keep the original sourceUrl (first source wins)
    await prisma.job.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        salary: params.salary || existing.salary,
        sector: params.sector !== 'General' ? params.sector : existing.sector,
      },
    })
    return
  }

  // New job — insert fresh
  await prisma.job.upsert({
    where: { sourceUrl: params.sourceUrl },
    create: {
      title: params.title,
      company: params.company,
      location: params.location,
      sector: params.sector,
      source: params.source,
      sourceUrl: params.sourceUrl,
      salary: params.salary,
      description: params.description,
      skills: params.skills,
      isActive: true,
      postedAt: new Date(),
    },
    update: {
      isActive: true,
      sector: params.sector,
      salary: params.salary,
    },
  })
}