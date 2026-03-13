import puppeteer from 'puppeteer'
import prisma from '../db/prisma'

const NIGERIAN_CITIES = [
  'Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan',
  'Kaduna', 'Enugu', 'Benin City', 'Warri', 'Calabar',
  'Owerri', 'Uyo', 'Jos', 'Ilorin', 'Abeokuta', 'Remote'
]

function detectLocation(text: string): string {
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

function detectSector(title: string): string {
  const t = title.toLowerCase()
  if (t.includes('data') || t.includes('analyst') ||
      t.includes('software') || t.includes('developer') ||
      t.includes('engineer') || t.includes('product manager') ||
      t.includes('devops') || t.includes('frontend') ||
      t.includes('backend') || t.includes('fullstack') ||
      t.includes('full-stack') || t.includes('it support') ||
      t.includes('ict') || t.includes('cybersecurity') ||
      t.includes('cloud') || t.includes('machine learning') ||
      t.includes('ai ')) return 'Tech'
  if (t.includes('bank') || t.includes('finance') ||
      t.includes('account') || t.includes('audit') ||
      t.includes('credit') || t.includes('loan') ||
      t.includes('investment') || t.includes('insurance')) return 'Banking'
  if (t.includes('oil') || t.includes('gas') ||
      t.includes('petroleum') || t.includes('drilling')) return 'Oil & Gas'
  if (t.includes('sales') || t.includes('marketing') ||
      t.includes('business dev') || t.includes('acquisition') ||
      t.includes('growth') || t.includes('brand')) return 'Sales'
  return 'General'
}

function extractSkills(text: string): string[] {
  const keywords = [
    'JavaScript', 'TypeScript', 'Python', 'React', 'Node.js',
    'SQL', 'MongoDB', 'AWS', 'DevOps', 'Docker', 'Java', 'PHP',
    'Laravel', 'Django', 'Flutter', 'Data Analysis', 'Excel',
    'PowerBI', 'Tableau', 'Sales', 'Marketing', 'Finance',
    'Accounting', 'Project Management', 'Agile', 'Scrum',
  ]
  const textLower = text.toLowerCase()
  return keywords.filter(k => textLower.includes(k.toLowerCase()))
}

export async function scrapeMyJobMag() {
  console.log('🔍 Scraping MyJobMag with Puppeteer...')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  // Use search URLs instead of category pages — more reliable
  const searchUrls = [
    { url: 'https://www.myjobmag.com/jobs/software-developer-jobs-in-nigeria', sector: 'Tech' },
    { url: 'https://www.myjobmag.com/jobs/data-analyst-jobs-in-nigeria', sector: 'Tech' },
    { url: 'https://www.myjobmag.com/jobs/it-jobs-in-nigeria', sector: 'Tech' },
    { url: 'https://www.myjobmag.com/jobs/banking-jobs-in-nigeria', sector: 'Banking' },
    { url: 'https://www.myjobmag.com/jobs/sales-jobs-in-nigeria', sector: 'Sales' },
    { url: 'https://www.myjobmag.com/jobs/remote-jobs-in-nigeria', sector: 'General' },
  ]

  let totalSaved = 0
  const seenUrls = new Set<string>()

  for (const { url: categoryUrl, sector } of searchUrls) {
    try {
      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

      console.log(`Visiting: ${categoryUrl}`)
      await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      await new Promise(r => setTimeout(r, 4000))

      const jobPaths = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="/job/"]'))
          .map(a => a.getAttribute('href') || '')
          .filter(href => href.startsWith('/job/'))
          .filter((v, i, arr) => arr.indexOf(v) === i)
      })

      console.log(`MyJobMag: found ${jobPaths.length} job URLs from ${categoryUrl}`)

      // Filter out already seen URLs to avoid duplicates across categories
      const newPaths = jobPaths.filter(p => !seenUrls.has(p))
      newPaths.forEach(p => seenUrls.add(p))

      for (const jobPath of newPaths.slice(0, 10)) {
        const jobUrl = `https://www.myjobmag.com${jobPath}`
        try {
          const jobPage = await browser.newPage()
          await jobPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

          await jobPage.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 20000 })
          await new Promise(r => setTimeout(r, 2000))

          const jobData = await jobPage.evaluate(() => {
            const h1 = document.querySelector('h1')?.textContent?.trim() || ''
            const atIndex = h1.lastIndexOf(' at ')
            const title = atIndex > 0 ? h1.slice(0, atIndex).trim() : h1
            const company = atIndex > 0 ? h1.slice(atIndex + 4).trim() : ''

            const allText = document.body?.textContent || ''

            const location = allText.match(
              /(Lagos|Abuja|Port Harcourt|Kano|Ibadan|Remote|Benin City|Enugu|Calabar|Owerri|Warri|Uyo|Jos|Ilorin|Nigeria)/i
            )?.[0] || 'Nigeria'

            const salaryMatch = allText.match(/[₦N]\s?[\d,]+(\s?[-–]\s?[₦N]?\s?[\d,]+)?/)
            const salary = salaryMatch?.[0]?.slice(0, 50) || ''

            const description = document.querySelector('.job-details')
              ?.textContent?.trim().slice(0, 500) || ''

            return { title, company, location, salary, description }
          })

          if (jobData.title && jobData.company) {
            await prisma.job.upsert({
              where: { sourceUrl: jobUrl },
              create: {
                title: jobData.title,
                company: jobData.company,
                location: detectLocation(jobData.location),
                sector: detectSector(jobData.title) !== 'General' ? detectSector(jobData.title) : sector,
                source: 'myjobmag',
                sourceUrl: jobUrl,
                salary: jobData.salary || null,
                description: jobData.description || `${jobData.title} at ${jobData.company}`,
                skills: extractSkills(`${jobData.title} ${jobData.description}`),
                isActive: true,
                postedAt: new Date(),
              },
              update: {
                isActive: true,
                sector: detectSector(jobData.title) !== 'General' ? detectSector(jobData.title) : sector,
                salary: jobData.salary || null,
              },
            })
            totalSaved++
            console.log(`✅ Saved: ${jobData.title} at ${jobData.company}`)
          }

          await jobPage.close()
          await new Promise(r => setTimeout(r, 1000))

        } catch (jobError) {
          console.error(`Error scraping ${jobUrl}:`, jobError)
          continue
        }
      }

      await page.close()

    } catch (error) {
      console.error(`MyJobMag error for ${categoryUrl}:`, error)
      continue
    }
  }

  await browser.close()
  console.log(`✅ MyJobMag: saved ${totalSaved} jobs`)
  return totalSaved
}