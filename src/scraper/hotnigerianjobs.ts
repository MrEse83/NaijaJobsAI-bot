import puppeteer from 'puppeteer'
import {
  detectLocation,
  detectSector,
  extractSkills,
  upsertJob,
  USER_AGENT,
  BROWSER_ARGS,
  sleep,
} from './utils'

// HotNigerianJobs category URLs — covers all major sectors
const categoryUrls = [
  { url: 'https://www.hotnigerianjobs.com/field/168/', sector: 'Tech' },      // Computer / ICT / AI
  { url: 'https://www.hotnigerianjobs.com/field/169/', sector: 'Tech' },      // Data Analytics
  { url: 'https://www.hotnigerianjobs.com/field/133/', sector: 'Banking' },   // Finance
  { url: 'https://www.hotnigerianjobs.com/field/128/', sector: 'Oil & Gas' }, // Oil & Gas
  { url: 'https://www.hotnigerianjobs.com/field/139/', sector: 'Sales' },     // Marketing & Sales
  { url: 'https://www.hotnigerianjobs.com/field/130/', sector: 'General' },   // Engineering
  { url: 'https://www.hotnigerianjobs.com/field/140/', sector: 'General' },   // HR
  { url: 'https://www.hotnigerianjobs.com/field/131/', sector: 'General' },   // Graduate Trainee
]

export async function scrapeHotNigerianJobs(): Promise<number> {
  console.log('🔍 Scraping HotNigerianJobs...')

  const browser = await puppeteer.launch({
    headless: true,
    args: BROWSER_ARGS,
  })

  const page = await browser.newPage()
  await page.setUserAgent(USER_AGENT)

  let totalSaved = 0
  const seenUrls = new Set<string>()

  try {
    for (const { url: categoryUrl, sector } of categoryUrls) {
      // ── Collect job URLs from category page ──
      let jobUrls: string[] = []
      try {
        console.log(`Visiting: ${categoryUrl}`)
        await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 30000 })
        await sleep(3000)

        jobUrls = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map((a) => a.getAttribute('href') || '')
            .filter((href) =>
              href.includes('hotnigerianjobs.com/jobs/') ||
              href.match(/hotnigerianjobs\.com\/\d+\//)
            )
            .filter((v, i, arr) => arr.indexOf(v) === i)
        })

        // fallback — get all internal links containing job patterns
        if (jobUrls.length === 0) {
          jobUrls = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('h2 a, h3 a, .job-title a'))
              .map((a) => a.getAttribute('href') || '')
              .filter((href) => href.length > 10)
              .filter((v, i, arr) => arr.indexOf(v) === i)
          })
        }
      } catch (error) {
        console.error(`Failed to load ${categoryUrl}:`, error)
        continue
      }

      const newUrls = jobUrls.filter((u) => !seenUrls.has(u))
      newUrls.forEach((u) => seenUrls.add(u))
      console.log(`Found ${jobUrls.length} URLs (${newUrls.length} new) from ${categoryUrl}`)

      // ── Scrape each job ──
      for (const jobUrl of newUrls.slice(0, 10)) {
        const fullUrl = jobUrl.startsWith('http')
          ? jobUrl
          : `https://www.hotnigerianjobs.com${jobUrl}`

        try {
          await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 20000 })
          await sleep(2000)

          const jobData = await page.evaluate(() => {
            const title = document.querySelector('h1, h2.job-title, .entry-title')
              ?.textContent?.trim() || ''

            // Company name often appears after "at" in title or in a dedicated element
            const companyEl = document.querySelector('.company-name, .employer, [class*="company"]')
            let company = companyEl?.textContent?.trim() || ''

            // Try to extract company from title if not found
            if (!company) {
              const atIndex = title.lastIndexOf(' at ')
              if (atIndex > 0) company = title.slice(atIndex + 4).trim()
            }

            // Try meta description or body text for company
            if (!company) {
              const bodyText = document.body?.textContent || ''
              const match = bodyText.match(/(?:Company|Employer|Organisation):\s*([^\n]+)/i)
              company = match?.[1]?.trim() || ''
            }

            const allText = document.body?.textContent || ''

            const location = allText.match(
              /(Lagos|Abuja|Port Harcourt|Kano|Ibadan|Remote|Benin City|Enugu|Calabar|Owerri|Warri|Uyo|Jos|Ilorin|Ogun|Oyo|Nigeria)/i
            )?.[0] || 'Nigeria'

            const salaryMatch = allText.match(/[₦N]\s?[\d,]+(\s?[-–]\s?[₦N]?\s?[\d,]+)?/)
            const salary = salaryMatch?.[0]?.slice(0, 50) || ''

            const descEl = document.querySelector(
              '.job-description, .entry-content, article, .content-area, main'
            )
            const description = descEl?.textContent?.trim().slice(0, 500) || ''

            return { title, company, location, salary, description }
          })

          // Clean up title — remove company from it if appended
          let cleanTitle = jobData.title
          if (jobData.company && cleanTitle.includes(jobData.company)) {
            cleanTitle = cleanTitle.replace(jobData.company, '').replace(/\s+at\s*$/, '').trim()
          }

          if (cleanTitle && jobData.company) {
            await upsertJob({
              title: cleanTitle,
              company: jobData.company,
              location: detectLocation(jobData.location),
              sector: detectSector(cleanTitle) !== 'General'
                ? detectSector(cleanTitle)
                : sector,
              source: 'hotnigerianjobs',
              sourceUrl: fullUrl,
              salary: jobData.salary || null,
              description: jobData.description || `${cleanTitle} at ${jobData.company}`,
              skills: extractSkills(`${cleanTitle} ${jobData.description}`),
            })
            totalSaved++
            console.log(`✅ Saved: ${cleanTitle} at ${jobData.company}`)
          } else {
            console.log(`⚠️ Skipped — missing title or company: ${fullUrl}`)
          }

          await sleep(1000)
        } catch (jobError) {
          console.error(`Error scraping ${fullUrl}:`, jobError)
        }
      }
    }
  } finally {
    await page.close()
    await browser.close()
    console.log(`✅ HotNigerianJobs: saved ${totalSaved} jobs`)
  }

  return totalSaved
}