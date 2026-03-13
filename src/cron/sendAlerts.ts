import 'dotenv/config'
import { getDB } from '../db/prisma'
import { matchJobsToUser } from '../ai/matchJobs'
import { Telegraf } from 'telegraf'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

export async function sendDailyAlerts() {
  console.log('⏰ Running daily job alerts...')
  const prisma = getDB()

  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        cv: { isNot: null },
      },
      include: { cv: true },
    })

    console.log(`📬 Sending alerts to ${users.length} users...`)

    for (const user of users) {
      try {
        const matches = await matchJobsToUser(user.id)

        if (matches.length === 0) {
          console.log(`No new matches for user ${user.telegramId}`)
          continue
        }

        const topMatches = matches.slice(0, 3)
        const jobDetails = await Promise.all(
          topMatches.map((m) =>
            prisma.job.findUnique({ where: { id: m.jobId } })
          )
        )

        const name = user.name || 'there'
        let message = `☀️ Good morning ${name}!\n\n`
        message += `🎯 Your top job matches today:\n\n`

        jobDetails.forEach((job, index) => {
          if (!job) return
          const match = topMatches[index]
          const scorePercent = Math.round(match.score * 100)
          message += `${index + 1}. ${job.title}\n`
          message += `🏢 ${job.company}\n`
          message += `📍 ${job.location}\n`
          message += `✅ ${scorePercent}% match\n`
          message += `🔗 ${job.sourceUrl}\n\n`
        })

        message += `Reply COVER 1, COVER 2, or COVER 3 for a cover letter.\n`
        message += `Powered by NaijaJobsAI 🇳🇬`

        await bot.telegram.sendMessage(user.telegramId, message, {
          link_preview_options: { is_disabled: true },
        })

        await prisma.jobMatch.updateMany({
          where: {
            userId: user.id,
            jobId: { in: topMatches.map((m) => m.jobId) },
          },
          data: { sentAt: new Date() },
        })

        console.log(`✅ Alert sent to ${user.telegramId}`)
        await new Promise((resolve) => setTimeout(resolve, 500))

      } catch (userError) {
        console.error(`Error sending alert to ${user.telegramId}:`, userError)
        continue
      }
    }

    console.log('✅ Daily alerts complete!')

  } catch (error) {
    console.error('Daily alerts error:', error)
  }
}