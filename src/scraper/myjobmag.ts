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

const searchUrls = [
  { url: 'https://www.myjobmag.com/jobs/software-developer-jobs-in-nigeria', sector: 'Tech' },
  { url: 'https://www.myjobmag.com/jobs/data-analyst-jobs-in-nigeria', sector: 'Tech' },
  { url: 'https://www.myjobmag.com/jobs/it-jobs-in-nigeria', sector: 'Tech' },
  { url: 'https://www.myjobmag.com/jobs/banking-jobs-in-nigeria', sector: 'Banking' },
  { url: 'https://www.myjobmag.com/jobs/sales-jobs-in-nigeria', sector: 'Sales' },
  { url: 'https://www.myjobmag.com/jobs/remote-jobs-in-nigeria', sector: 'General' },
]

export async function scrapeMyJobMag(): Promise<number> {
  console.log('🔍 Scraping MyJobMag...')

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
    for (const { url: categoryUrl, sector } of searchUrls) {
      // ── Collect job paths from category page ──
      let jobPaths: string[] = []
      try {
        console.log(`Visiting: ${categoryUrl}`)
        await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 30000 })
        await sleep(4000)

        jobPaths = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href*="/job/"]'))
            .map((a) => a.getAttribute('href') || '')
            .filter((href) => href.startsWith('/job/'))
            .filter((v, i, arr) => arr.indexOf(v) === i)
        })
      } catch (error) {
        console.error(`Failed to load category ${categoryUrl}:`, error)
        continue
      }

      const newPaths = jobPaths.filter((p) => !seenUrls.has(p))
      newPaths.forEach((p) => seenUrls.add(p))
      console.log(`Found ${jobPaths.length} URLs (${newPaths.length} new) from ${categoryUrl}`)

      // ── Scrape each job using the SAME page ──
      for (const jobPath of newPaths.slice(0, 10)) {
        const jobUrl = `https://www.myjobmag.com${jobPath}`
        try {
          await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 20000 })
          await sleep(2000)

          const jobData = await page.evaluate(() => {
            const h1 = document.querySelector('h1')?.textContent?.trim() || ''
            const atIndex = h1.lastIndexOf(' at ')
            const title = atIndex > 0 ? h1.slice(0, atIndex).trim() : h1
            const company = atIndex > 0 ? h1.slice(atIndex + 4).trim() : ''
            const allText = document.body?.textContent || ''
            const location =
              allText.match(
                /(Lagos|Abuja|Port Harcourt|Kano|Ibadan|Remote|Benin City|Enugu|Calabar|Owerri|Warri|Uyo|Jos|Ilorin|Nigeria)/i
              )?.[0] || 'Nigeria'
            const salaryMatch = allText.match(/[₦N]\s?[\d,]+(\s?[-–]\s?[₦N]?\s?[\d,]+)?/)
            const salary = salaryMatch?.[0]?.slice(0, 50) || ''
            const description =
              document.querySelector('.job-details')?.textContent?.trim().slice(0, 500) || ''
            return { title, company, location, salary, description }
          })

          if (jobData.title && jobData.company) {
            const sector_ = detectSector(jobData.title) !== 'General'
              ? detectSector(jobData.title)
              : sector

            await upsertJob({
              title: jobData.title,
              company: jobData.company,
              location: detectLocation(jobData.location),
              sector: sector_,
              source: 'myjobmag',
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
          console.error(`Error scraping ${jobUrl}:`, jobError)
          // continue to next job — page is still usable
        }
      }
    }
  } finally {
    // ── Always runs — even if an error is thrown above ──
    await page.close()
    await browser.close()
    console.log(`✅ MyJobMag: saved ${totalSaved} jobs`)
  }

  return totalSaved
}