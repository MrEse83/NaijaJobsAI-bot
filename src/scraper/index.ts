import 'dotenv/config'
import { scrapeJobberman } from './jobberman'
import { scrapeMyJobMag } from './myjobmag'

export async function runAllScrapers() {
  console.log('🚀 Starting all scrapers...')
  console.log('================================')

  const results = {
    jobberman: 0,
    myjobmag: 0,
    total: 0,
  }

  try {
    results.jobberman = await scrapeJobberman()
  } catch (error) {
    console.error('Jobberman scraper failed:', error)
  }

  try {
    results.myjobmag = await scrapeMyJobMag()
  } catch (error) {
    console.error('MyJobMag scraper failed:', error)
  }

  results.total = results.jobberman + results.myjobmag

  console.log('================================')
  console.log(`✅ Scraping complete!`)
  console.log(`📊 Results:`)
  console.log(`   Jobberman: ${results.jobberman} jobs`)
  console.log(`   MyJobMag:  ${results.myjobmag} jobs`)
  console.log(`   Total:     ${results.total} jobs`)

  return results
}

// Allow running directly from terminal
if (require.main === module) {
  runAllScrapers()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Scraper error:', error)
      process.exit(1)
    })
}