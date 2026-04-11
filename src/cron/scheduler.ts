import 'dotenv/config'
import cron from 'node-cron'
import { Telegraf } from 'telegraf'
import { getDB } from '../db/prisma'
import { runAllScrapers } from '../scraper/index'
import { sendDailyAlerts } from './sendAlerts'
import { expirePremiumSubscriptions } from './expireSubscriptions'

// bot is passed in from index.ts — no duplicate instance created here
export function startScheduler(bot: Telegraf) {
  console.log('⏰ NaijaJobsAI Scheduler starting...')

  // Scrape jobs every 6 hours: 12am, 6am, 12pm, 6pm
  cron.schedule('0 0,6,12,18 * * *', async () => {
    console.log('🔍 Starting scheduled job scrape...')
    try {
      await runAllScrapers()
    } catch (error) {
      console.error('Scheduled scrape error:', error)
    }
  })

  // Expire old jobs daily at 4am WAT (3am UTC)
  // Jobs older than 30 days are marked inactive
  cron.schedule('0 3 * * *', async () => {
    console.log('🗑️ Expiring old jobs...')
    try {
      const prisma = getDB()
      const result = await prisma.$executeRaw`
        UPDATE "Job"
        SET "isActive" = false
        WHERE "postedAt" < NOW() - INTERVAL '30 days'
        AND "isActive" = true
      `
      console.log(`✅ Expired ${result} old jobs`)
    } catch (error) {
      console.error('Job expiry error:', error)
    }
  })

  // Check and expire premium subscriptions daily at 6am WAT (5am UTC)
  // Runs before daily alerts so expired users get free-tier matches, not premium
  cron.schedule('0 5 * * *', async () => {
    console.log('💳 Checking expired subscriptions...')
    try {
      await expirePremiumSubscriptions(bot)
    } catch (error) {
      console.error('Subscription expiry error:', error)
    }
  })

  // Send daily job alerts at 8am WAT (7am UTC)
  cron.schedule('0 7 * * *', async () => {
    console.log('📬 Sending daily job alerts...')
    try {
      await sendDailyAlerts(bot)
    } catch (error) {
      console.error('Daily alerts error:', error)
    }
  })

  console.log('✅ Scheduler running:')
  console.log('   🔍 Job scraping: every 6 hours')
  console.log('   🗑️ Job expiry: 4am WAT daily')
  console.log('   💳 Subscription expiry: 6am WAT daily')
  console.log('   📬 Daily alerts: 8am WAT daily')
}