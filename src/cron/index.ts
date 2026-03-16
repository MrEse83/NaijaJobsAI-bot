import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { startScheduler } from './scheduler'

console.log('🚀 NaijaJobsAI Scheduler starting on Railway...')

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

// Start all cron jobs
startScheduler(bot)

console.log('✅ Scheduler is live')
console.log('   🔍 Job scraping: every 6 hours')
console.log('   💳 Subscription expiry: 6am WAT daily')
console.log('   📬 Daily alerts: 8am WAT daily')

// Keep the process alive
process.on('SIGINT', () => {
  console.log('Scheduler stopped')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Scheduler stopped')
  process.exit(0)
})