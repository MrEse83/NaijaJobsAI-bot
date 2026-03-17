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
  { url: 'https://www.hotnigerianjobs.com/field/168/', sector: 'Tech' },
  { url: 'https://www.hotnigerianjobs.com/field/133/', sector: 'Banking' },
  { url: 'https://www.hotnigerianjobs.com/field/128/', sector: 'Oil & Gas' },
  { url: 'https://www.hotnigerianjobs.com/field/139/', sector: 'Sales' },
  { url: 'https://www.hotnigerianjobs.com/field/130/', sector: 'General' },
  { url: 'https://www.hotnigerianjobs.com/field/233/', sector: 'General' },
  { url: 'https://www.hotnigerianjobs.com/field/131/', sector: 'General' },
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
      let postUrls: string[] = []
      try {
        console.log(`Visiting: ${categoryUrl}`)
        await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 35000 })
        await sleep(3000)

        postUrls = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href*="/hotjobs/"]'))
            .map((a) => a.getAttribute('href') || '')
            .filter((href) => href.includes('/hotjobs/'))
            .filter((v, i, arr) => arr.indexOf(v) === i)
        })
      } catch (error) {
        console.error(`Failed to load ${categoryUrl}:`, error)
        continue
      }

      const newPostUrls = postUrls.filter((u) => !seenUrls.has(u))
      newPostUrls.forEach((u) => seenUrls.add(u))
      console.log(`Found ${postUrls.length} posts (${newPostUrls.length} new) from ${categoryUrl}`)

      for (const postUrl of newPostUrls.slice(0, 10)) {
        const fullUrl = postUrl.startsWith('http')
          ? postUrl
          : `https://www.hotnigerianjobs.com${postUrl}`

        try {
          await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
          await sleep(2000)

          const jobData = await page.evaluate(() => {
            const h1 = document.querySelector('h1')?.textContent?.trim() || ''

            // Format 1: "Company Name Job Recruitment (X Positions)"
            const recruitmentMatch = h1.match(/^(.+?)\s+(?:Job Recruitment|Internship & Exp|Graduate|Massive Recruitment)/i)
            // Format 2: "Job Title at Company Name" (single job posts)
            const atMatch = h1.match(/\bat\s+(.+?)(?:\s*[-|]|$)/i)
            // Format 3: dedicated company element
            const metaCompany = document.querySelector('.company, .employer, [itemprop="hiringOrganization"]')
              ?.textContent?.trim() || ''

            const company = recruitmentMatch?.[1]?.trim() || metaCompany || atMatch?.[1]?.trim() || ''

            const allText = document.body?.textContent || ''
            const location = allText.match(
              /(Lagos|Abuja|Port Harcourt|Kano|Ibadan|Remote|Benin City|Enugu|Calabar|Owerri|Warri|Uyo|Jos|Ilorin|Nigeria)/i
            )?.[0] || 'Nigeria'

            const salaryMatch = allText.match(/(?:Salary|NGN|N)\s?[\d,]+(\s?[-]\s?(?:NGN|N)?\s?[\d,]+)?/i)
            const salary = salaryMatch?.[0]?.slice(0, 50) || ''

            const articleEl = document.querySelector('.entry-content, article, #content, .post-content')
            const description = articleEl?.textContent?.trim().slice(0, 500) || ''

            // Extract positions — try multiple selectors
            const positions: string[] = []

            if (articleEl) {
              // Try <li> items that look like job titles (short, no action words)
              articleEl.querySelectorAll('li').forEach((el) => {
                const text = el.textContent?.trim() || ''
                if (
                  text.length > 5 &&
                  text.length < 80 &&
                  !text.toLowerCase().includes('apply') &&
                  !text.toLowerCase().includes('deadline') &&
                  !text.toLowerCase().includes('click') &&
                  !text.toLowerCase().includes('subscribe') &&
                  !text.toLowerCase().includes('requirement') &&
                  !text.toLowerCase().includes('qualification') &&
                  !text.toLowerCase().includes('how to') &&
                  !text.toLowerCase().includes('method') &&
                  !text.match(/^\d+$/)
                ) {
                  positions.push(text)
                }
              })

              // If no li items found, try strong/b
              if (positions.length === 0) {
                articleEl.querySelectorAll('strong, b').forEach((el) => {
                  const text = el.textContent?.trim() || ''
                  if (
                    text.length > 5 &&
                    text.length < 80 &&
                    !text.toLowerCase().includes('apply') &&
                    !text.toLowerCase().includes('deadline') &&
                    !text.toLowerCase().includes('click') &&
                    !text.toLowerCase().includes('requirement') &&
                    !text.match(/^\d+$/)
                  ) {
                    positions.push(text)
                  }
                })
              }
            }

            // For single job posts (Format 2), extract title from h1
            const isSingleJob = !h1.match(/\d+\s*Positions?/i) && atMatch
            const singleJobTitle = isSingleJob
              ? h1.replace(/\s+at\s+.+$/i, '').trim()
              : ''

            return { company, location, salary, description, positions, h1, singleJobTitle }
          })

          if (!jobData.company) {
            console.log(`⚠️ Skipped — no company: ${fullUrl}`)
            continue
          }

          // Single job post — save directly
          if (jobData.singleJobTitle) {
            await upsertJob({
              title: jobData.singleJobTitle,
              company: jobData.company,
              location: detectLocation(jobData.location),
              sector: detectSector(jobData.singleJobTitle) !== 'General'
                ? detectSector(jobData.singleJobTitle)
                : sector,
              source: 'hotnigerianjobs',
              sourceUrl: fullUrl,
              salary: jobData.salary || null,
              description: jobData.description || `${jobData.singleJobTitle} at ${jobData.company}`,
              skills: extractSkills(`${jobData.singleJobTitle} ${jobData.description}`),
            })
            totalSaved++
            console.log(`✅ Saved: ${jobData.singleJobTitle} at ${jobData.company}`)
            await sleep(1000)
            continue
          }

          // Multi-position post — save each position
          if (jobData.positions.length > 0) {
            for (const position of jobData.positions.slice(0, 10)) {
              await upsertJob({
                title: position,
                company: jobData.company,
                location: detectLocation(jobData.location),
                sector: detectSector(position) !== 'General' ? detectSector(position) : sector,
                source: 'hotnigerianjobs',
                sourceUrl: fullUrl,
                salary: jobData.salary || null,
                description: jobData.description || `${position} at ${jobData.company}`,
                skills: extractSkills(`${position} ${jobData.description}`),
              })
              totalSaved++
              console.log(`✅ Saved: ${position} at ${jobData.company}`)
            }
          } else {
            // Fallback — save h1 as the job title
            await upsertJob({
              title: jobData.h1,
              company: jobData.company,
              location: detectLocation(jobData.location),
              sector,
              source: 'hotnigerianjobs',
              sourceUrl: fullUrl,
              salary: jobData.salary || null,
              description: jobData.description || `${jobData.h1} at ${jobData.company}`,
              skills: extractSkills(`${jobData.h1} ${jobData.description}`),
            })
            totalSaved++
            console.log(`✅ Saved (fallback): ${jobData.h1} at ${jobData.company}`)
          }

          await sleep(1000)
        } catch (postError) {
          console.error(`Error scraping ${fullUrl}:`, postError)
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