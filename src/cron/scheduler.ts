import 'dotenv/config'
import cron from 'node-cron'
import { runAllScrapers } from '../scraper/index'
import { sendDailyAlerts } from './sendAlerts'

console.log('⏰ NaijaJobsAI Scheduler starting...')

// Scrape jobs every 6 hours
// Runs at 12am, 6am, 12pm, 6pm daily
cron.schedule('0 0,6,12,18 * * *', async () => {
  console.log('🔍 Starting scheduled job scrape...')
  try {
    await runAllScrapers()
  } catch (error) {
    console.error('Scheduled scrape error:', error)
  }
})

// Send daily job alerts at 8am Nigeria time (UTC+1)
// 7am UTC = 8am WAT (West Africa Time)
cron.schedule('0 7 * * *', async () => {
  console.log('📬 Sending daily job alerts...')
  try {
    await sendDailyAlerts()
  } catch (error) {
    console.error('Daily alerts error:', error)
  }
})

console.log('✅ Scheduler running:')
console.log('   🔍 Job scraping: every 6 hours')
console.log('   📬 Daily alerts: 8am WAT every day')