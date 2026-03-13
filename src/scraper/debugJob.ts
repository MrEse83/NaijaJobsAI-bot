import puppeteer from 'puppeteer'

async function debug() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

  // Visit one real job listing
  const url = 'https://www.jobberman.com/listings/data-engineer-analytics-data-infrastructure-458wqm'
  console.log('Visiting:', url)
  
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))

  const data = await page.evaluate(() => {
    // Get all text content of h1, h2, h3
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => `${h.tagName}: ${h.textContent?.trim()}`)
      .slice(0, 10)

    // Get all elements with class names containing useful keywords
    const classNames = Array.from(document.querySelectorAll('[class]'))
      .map(el => el.className)
      .filter(c => typeof c === 'string' && (
        c.includes('title') || c.includes('company') || 
        c.includes('location') || c.includes('salary') ||
        c.includes('job') || c.includes('employer')
      ))
      .slice(0, 20)

    return { headings, classNames }
  })

  console.log('\n=== HEADINGS ===')
  data.headings.forEach(h => console.log(h))
  
  console.log('\n=== RELEVANT CLASS NAMES ===')
  data.classNames.forEach(c => console.log(c))

  await browser.close()
}

debug().catch(console.error)