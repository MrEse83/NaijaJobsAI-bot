import axios from 'axios'
import {
  extractSkills,
  upsertJob,
  sleep,
} from './utils'

const REMOTIVE_API = 'https://remotive.com/api/remote-jobs'

interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  category: string
  tags: string[]
  job_type: string
  publication_date: string
  candidate_required_location: string
  salary: string
  description: string
}

function mapCategory(category: string): string {
  const map: Record<string, string> = {
    'software-dev': 'Tech',
    'data': 'Tech',
    'devops-sysadmin': 'Tech',
    'product': 'Tech',
    'design': 'Tech',
    'finance-legal': 'Banking',
    'marketing': 'Sales',
    'hr': 'HR',
    'customer-support': 'General',
    'writing': 'General',
    'business': 'General',
    'project-mgmt': 'General',
  }
  return map[category] || 'General'
}

function isNigeriaEligible(location: string): boolean {
  if (!location || location.trim() === '') return true
  const l = location.toLowerCase()

  if (
    l.includes('nigeria') ||
    l.includes('africa') ||
    l.includes('worldwide') ||
    l.includes('anywhere') ||
    l.includes('global') ||
    l.includes('remote') ||
    l === ''
  ) return true

  // Reject if location mentions USA/Canada/Europe without worldwide/Africa
if (
  (l.includes('usa') ||
   l.includes('us)') ||
   l.includes('u.s.') ||
   l.includes('united states') ||
   l.includes('canada') ||
   l.includes('latam') ||
   l.includes('brazil') ||
   l.includes('argentina') ||
   l.includes('americas') ||
   l.includes('israel')) &&
  !l.includes('worldwide') &&
  !l.includes('africa') &&
  !l.includes('nigeria') &&
  !l.includes('global')
) return false

  // If it mentions specific countries/regions but not Nigeria — still include
  // because many listings say "USA, Europe, Africa" etc
  return true
}

export async function scrapeRemotive(): Promise<number> {
  console.log('🌍 Scraping Remotive API...')

  let totalSaved = 0
  const seenIds = new Set<number>()

  try {
    // Fetch all jobs at once — limit 100
    const response = await axios.get(REMOTIVE_API, {
      params: { limit: 100 },
      timeout: 20000,
    })

    const jobs: RemotiveJob[] = response.data?.jobs || []
    console.log(`Found ${jobs.length} total remote jobs on Remotive`)

    for (const job of jobs) {
      try {
        // Skip already processed jobs (dedup by Remotive ID)
        if (seenIds.has(job.id)) continue
        seenIds.add(job.id)

        // Only include jobs Nigerians can apply to
        if (!isNigeriaEligible(job.candidate_required_location)) {
          console.log(`⏭ Skipped (location restricted): ${job.title}`)
          continue
        }

        // Clean HTML from description
        const cleanDescription = job.description
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 500)

        const skillsText = `${job.title} ${cleanDescription} ${job.tags.join(' ')}`
        const location = job.candidate_required_location || 'Remote (Worldwide)'

        await upsertJob({
          title: job.title,
          company: job.company_name,
          location,
          sector: mapCategory(job.category),
          source: 'remotive',
          sourceUrl: job.url,
          salary: job.salary || null,
          description: cleanDescription,
          skills: extractSkills(skillsText),
        })

        totalSaved++
        console.log(`✅ Saved: ${job.title} at ${job.company_name} (${location})`)

        await sleep(100)

      } catch (jobError) {
        console.error(`Error saving ${job.title}:`, jobError)
        continue
      }
    }

  } catch (error) {
    console.error('Remotive API error:', error)
  }

  console.log(`✅ Remotive: saved ${totalSaved} jobs`)
  return totalSaved
}