import puppeteer from 'puppeteer'

async function debug() {
  console.log('🔍 Debugging Jobberman HTML...')
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
  
  await page.goto('https://www.jobberman.com/jobs/it-software', { 
    waitUntil: 'networkidle2', 
    timeout: 30000 
  })

  // Wait extra time for JS to load
  await new Promise(r => setTimeout(r, 5000))

  // Get page title and first 3000 chars of HTML
  const title = await page.title()
  const html = await page.content()
  
  console.log('Page title:', title)
  console.log('HTML length:', html.length)
  console.log('\nFirst 3000 chars of HTML:')
  console.log(html.slice(0, 3000))
  
  await browser.close()
}

debug().catch(console.error)