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

const categoryUrls = [
  'https://www.jobberman.com/jobs/it-software',
  'https://www.jobberman.com/jobs/it-software?page=2',
  'https://www.jobberman.com/jobs/it-software?page=3',
  'https://www.jobberman.com/jobs/banking-finance',
  'https://www.jobberman.com/jobs/banking-finance?page=2',
  'https://www.jobberman.com/jobs/oil-gas-energy',
  'https://www.jobberman.com/jobs/sales-business-development',
  'https://www.jobberman.com/jobs/sales-business-development?page=2',
]

export async function scrapeJobberman(): Promise<number> {
  console.log('🔍 Scraping Jobberman...')

  const browser = await puppeteer.launch({
    headless: true,
    args: BROWSER_ARGS,
  })

  // One reusable page for the entire scrape session
  // Never leaks — always closed in the finally block
  const page = await browser.newPage()
  await page.setUserAgent(USER_AGENT)

  let totalSaved = 0
  const seenUrls = new Set<string>()

  try {
    for (const categoryUrl of categoryUrls) {
      // ── Collect job URLs from category page ──
      let jobUrls: string[] = []
      try {
        console.log(`Visiting: ${categoryUrl}`)
        await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 30000 })
        await sleep(3000)

        jobUrls = await page.evaluate(() => {
          const links = document.querySelectorAll('link[rel="prerender"]')
          return Array.from(links)
            .map((link) => link.getAttribute('href') || '')
            .filter((href) => href.includes('/listings/'))
        })
      } catch (error) {
        console.error(`Failed to load category ${categoryUrl}:`, error)
        continue
      }

      const newUrls = jobUrls.filter((u) => !seenUrls.has(u))
      newUrls.forEach((u) => seenUrls.add(u))
      console.log(`Found ${jobUrls.length} URLs (${newUrls.length} new) from ${categoryUrl}`)

      // ── Scrape each job using the SAME page ──
      for (const jobUrl of newUrls.slice(0, 10)) {
        try {
          await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 20000 })
          await sleep(2000)

          const jobData = await page.evaluate(() => {
            const title = document.querySelector('h1')?.textContent?.trim() || ''
            const company = document.querySelector('h2')?.textContent?.trim() || ''
            const detailsText = document.querySelector('.job__details')?.textContent?.trim() || ''
            const location =
              detailsText.match(/(Lagos|Abuja|Port Harcourt|Kano|Ibadan|Remote|Nigeria)/i)?.[0] || 'Nigeria'
            const salaryMatch = detailsText.match(/[₦N]\s?[\d,]+(\s?[-–]\s?[₦N]?\s?[\d,]+)?/)
            const salary = salaryMatch?.[0]?.slice(0, 50) || ''
            const description = detailsText.slice(0, 500)
            return { title, company, location, salary, description }
          })

          if (jobData.title && jobData.company) {
            await upsertJob({
              title: jobData.title,
              company: jobData.company,
              location: detectLocation(jobData.location),
              sector: detectSector(jobData.title),
              source: 'jobberman',
              sourceUrl: jobUrl,
              salary: jobData.salary || null,
              description: jobData.description || `${jobData.title} at ${jobData.company}`,
              skills: extractSkills(`${jobData.title} ${jobData.description}`),
            })
            totalSaved++
            console.log(`✅ Saved: ${jobData.title} at ${jobData.company}`)
          }

          await sleep(1000)
        } catch (jobError) {
          console.error(`Error scraping job ${jobUrl}:`, jobError)
          // continue to next job — page is still usable
        }
      }
    }
  } finally {
    // ── Always runs — even if an error is thrown above ──
    await page.close()
    await browser.close()
    console.log(`✅ Jobberman: saved ${totalSaved} jobs`)
  }

  return totalSaved
}