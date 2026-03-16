import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { getDB } from '../db/prisma'
import { matchJobsToUser } from '../ai/matchJobs'

// ─────────────────────────────────────────────
// Send matches to ONE specific user
// Called by: NOW command in index.ts
// ─────────────────────────────────────────────
export async function matchAndAlertUser(
  userId: string,
  bot: Telegraf
): Promise<void> {
  const prisma = getDB()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { cv: true, subscription: true },
  })

  if (!user || !user.cv || !user.isActive) return

  const matches = await matchJobsToUser(userId)

  if (matches.length === 0) {
    await bot.telegram.sendMessage(
      user.telegramId,
      `No new matching jobs found right now.\n\n` +
      `New jobs are scraped every 6 hours — try again later.\n` +
      `Reply /upgrade for priority matching.`
    )
    return
  }

  const isPremium = user.isPremium && user.subscription?.isActive
  const topMatches = matches.slice(0, isPremium ? 5 : 3)

  const jobDetails = await Promise.all(
    topMatches.map((m) => prisma.job.findUnique({ where: { id: m.jobId } }))
  )

  const name = user.name || 'there'
  let message = `Your top job matches, ${name}\n\n`

  jobDetails.forEach((job, i) => {
    if (!job) return
    const match = topMatches[i]
    const score = Math.round(match.score * 100)
    message += `${i + 1}. ${job.title}\n`
    message += `   ${job.company} | ${job.location}\n`
    message += `   ${score}% match — ${match.reasons.slice(0, 2).join(' · ')}\n`
    message += `   ${job.salary || 'Salary not listed'}\n`
    message += `   ${job.sourceUrl}\n\n`
  })

  message += `Reply COVER 1, COVER 2, or COVER 3 to get a cover letter for any of these jobs.`

  if (!isPremium && matches.length > 3) {
    message += `\n\nUpgrade to Premium to unlock your top 5 matches — reply /upgrade`
  }

  await bot.telegram.sendMessage(user.telegramId, message, {
    link_preview_options: { is_disabled: true },
  })

  // Mark matches as sent
  await prisma.jobMatch.updateMany({
    where: {
      userId,
      jobId: { in: topMatches.map((m) => m.jobId) },
      sentAt: null,
    },
    data: { sentAt: new Date() },
  })

  console.log(`✅ Alert sent to ${user.telegramId}`)
}

// ─────────────────────────────────────────────
// Send matches to ALL active users
// Called by: 7am cron in scheduler.ts
// ─────────────────────────────────────────────
export async function sendDailyAlerts(bot: Telegraf): Promise<void> {
  console.log('📬 Running daily job alerts...')
  const prisma = getDB()

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      cv: { isNot: null },
    },
    select: { id: true, telegramId: true },
  })

  console.log(`Found ${users.length} active users with CVs`)

  let sent = 0
  let failed = 0

  for (const user of users) {
    try {
      await matchAndAlertUser(user.id, bot)
      sent++
      // 300ms delay between users to respect Telegram rate limits
      await new Promise((r) => setTimeout(r, 300))
    } catch (error) {
      console.error(`Failed to alert user ${user.telegramId}:`, error)
      failed++
    }
  }

  console.log(`✅ Daily alerts complete — sent: ${sent}, failed: ${failed}`)
}