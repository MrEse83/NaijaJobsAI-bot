require('dotenv').config()
import express from 'express'
import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import cron from 'node-cron'
import { handleStart } from './bot/handlers/start'
import { handleDocument } from './bot/handlers/cv'
import { generateCoverLetter } from './ai/coverLetter'
import { runAllScrapers } from './scraper/index'
import { sendDailyAlerts, matchAndAlertUser } from './cron/sendAlerts'
import { createWebhookHandler } from './bot/handlers/webhook'
import {
  canRequestMatch,
  canRequestCover,
  incrementMatchCount,
  incrementCoverCount,
  getUpgradeMessage,
} from './bot/handlers/subscription'
import prisma from './db/prisma'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

// ==================
// BOT HANDLERS
// ==================

bot.start(handleStart)

bot.on(message('document'), handleDocument)

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text.toUpperCase().trim()
  const originalText = ctx.message.text.trim()
  const telegramId = ctx.from?.id.toString()
  if (!telegramId) return

  // Handle NOW
  if (text === 'NOW') {
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { cv: true },
      })

      if (!user?.cv) {
        await ctx.reply('Please upload your CV first so I can find matching jobs for you 📄')
        return
      }

      const check = await canRequestMatch(user.id)
      if (!check.allowed) {
        await ctx.reply(check.reason || 'Daily limit reached.')
        return
      }

      await ctx.reply('🔍 Finding your best matches right now...')
      await incrementMatchCount(user.id)
      await matchAndAlertUser(user.id, bot)
      return

    } catch (error) {
      await ctx.reply('Something went wrong. Please try again.')
      return
    }
  }

  // Handle COVER 1, COVER 2, COVER 3
  if (text.startsWith('COVER ')) {
    const jobNumber = parseInt(text.split(' ')[1]) - 1
    if (isNaN(jobNumber) || jobNumber < 0 || jobNumber > 2) {
      await ctx.reply('Please reply COVER 1, COVER 2, or COVER 3')
      return
    }

    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
      })

      if (!user) {
        await ctx.reply('Please start by sending /start')
        return
      }

      const check = await canRequestCover(user.id)
      if (!check.allowed) {
        await ctx.reply(check.reason || 'Daily limit reached.')
        return
      }

      await ctx.reply('✍️ Generating your cover letter...')

      const recentMatches = await prisma.jobMatch.findMany({
        where: {
          userId: user.id,
          sentAt: { not: null },
        },
        orderBy: { sentAt: 'desc' },
        take: 3,
        include: { job: true },
      })

      if (recentMatches.length === 0 || !recentMatches[jobNumber]) {
        await ctx.reply('No recent job matches found. Reply NOW to get your latest matches first.')
        return
      }

      const selectedMatch = recentMatches[jobNumber]
      const coverLetter = await generateCoverLetter(user.id, selectedMatch.jobId)

      await ctx.reply(
        `Cover Letter for ${selectedMatch.job.title} at ${selectedMatch.job.company}\n\n` +
        `${coverLetter}\n\n` +
        `Apply here: ${selectedMatch.job.sourceUrl}\n\n` +
        `Want to track this application? Reply TRACK ${selectedMatch.job.company}`,
        { link_preview_options: { is_disabled: true } }
      )

      await incrementCoverCount(user.id)

      await prisma.application.create({
        data: {
          userId: user.id,
          jobTitle: selectedMatch.job.title,
          company: selectedMatch.job.company,
          coverLetter,
          status: 'applied',
        },
      })

    } catch (error) {
      console.error('Cover letter error:', error)
      await ctx.reply('Something went wrong generating your cover letter. Please try again.')
    }
    return
  }

  // Handle TRACK [company]
  if (text.startsWith('TRACK ')) {
    const company = originalText.replace(/^TRACK /i, '')
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } })
      if (!user) return

      await ctx.reply(
        `✅ Tracking your application to ${company}\n\n` +
        `Use /status to see all your tracked applications.`
      )
    } catch (error) {
      await ctx.reply('Could not track application. Try again.')
    }
    return
  }

  // ─────────────────────────────────────────────
// STEP 1 — Add this field to your User model in prisma/schema.prisma
// ─────────────────────────────────────────────

// Inside the User model, add:
//   lastPaidClaim  DateTime?

// Then run:
//   npx prisma migrate dev --name add_last_paid_claim
// or if on production:
//   npx prisma db push


// ─────────────────────────────────────────────
// STEP 2 — Replace the PAID block in index.ts with this
// ─────────────────────────────────────────────

  // Handle PAID
  if (text.startsWith('PAID ')) {
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } })
      if (!user) return

      // ── Rate limit: max 1 PAID claim per user per 24 hours ──
      if (user.lastPaidClaim) {
        const hoursSinceLast =
          (Date.now() - new Date(user.lastPaidClaim).getTime()) / (1000 * 60 * 60)

        if (hoursSinceLast < 24) {
          const hoursLeft = Math.ceil(24 - hoursSinceLast)
          await ctx.reply(
            `You have already submitted a payment claim today.\n\n` +
            `Please wait ${hoursLeft} hour(s) before submitting again.\n\n` +
            `If your account has not been activated yet, please contact support.`
          )
          return
        }
      }

      // ── Already premium? No need to claim ──
      if (user.isPremium) {
        await ctx.reply(
          `Your account is already Premium.\n\n` +
          `Reply /status to see your plan details.`
        )
        return
      }

      // ── Validate amount ──
      const parts = originalText.split(' ')
      const amount = parseInt(parts[parts.length - 1])

      if (isNaN(amount) || amount < 3000) {
        await ctx.reply(
          `Payment amount does not match our Premium plan of ₦3,000.\n\n` +
          `Please send: PAID 3000\n\n` +
          `If you made a mistake please contact support.`
        )
        return
      }

      // ── Record the claim timestamp ──
      await prisma.user.update({
        where: { telegramId },
        data: { lastPaidClaim: new Date() },
      })

      await ctx.reply(
        `✅ Payment claim received! We will verify and activate your Premium account within 5 minutes.\n\n` +
        `You will receive a confirmation message once your account is upgraded.`
      )

      // ── Notify admin ──
      const adminId = process.env.ADMIN_TELEGRAM_ID
      if (adminId) {
        await bot.telegram.sendMessage(
          adminId,
          `💰 New payment claim!\n\n` +
          `User: ${user.name || user.telegramHandle || telegramId}\n` +
          `Telegram ID: ${telegramId}\n` +
          `Amount claimed: ₦${amount.toLocaleString()}\n` +
          `Message: ${originalText}\n\n` +
          `Reply ACTIVATE ${telegramId} to activate.`
        )
      }

    } catch (error) {
      console.error('PAID handler error:', error)
      await ctx.reply('Could not process payment claim. Please try again.')
    }
    return
  }
  // Handle ACTIVATE [telegramId] — admin only
  if (text.startsWith('ACTIVATE ')) {
    const adminId = process.env.ADMIN_TELEGRAM_ID
    if (telegramId !== adminId) return

    const targetId = text.split(' ')[1]
    try {
      const targetUser = await prisma.user.findUnique({
        where: { telegramId: targetId },
      })
      if (!targetUser) {
        await ctx.reply('User not found.')
        return
      }

      const endDate = new Date()
      endDate.setMonth(endDate.getMonth() + 1)

      await prisma.user.update({
        where: { telegramId: targetId },
        data: { isPremium: true },
      })

      await prisma.subscription.upsert({
        where: { userId: targetUser.id },
        create: {
          userId: targetUser.id,
          plan: 'premium',
          amount: 3000,
          startDate: new Date(),
          endDate,
          isActive: true,
        },
        update: {
          plan: 'premium',
          amount: 3000,
          startDate: new Date(),
          endDate,
          isActive: true,
        },
      })

      await bot.telegram.sendMessage(
        targetId,
        '🌟 Your NaijaJobsAI Premium is now active!\n\n' +
        'You now have:\n' +
        '• 10 match requests per day\n' +
        '• Unlimited cover letters\n' +
        '• Top 5 job matches\n\n' +
        'Reply NOW to get your premium matches!'
      )

      await ctx.reply(`✅ Activated premium for ${targetId}`)

    } catch (error) {
      await ctx.reply('Could not activate premium. Check the Telegram ID and try again.')
    }
    return
  }

  // Handle /upgrade
  if (text === '/UPGRADE' || text === 'UPGRADE') {
    const upgradeMsg = getUpgradeMessage().replace('{TELEGRAM_ID}', telegramId)
    await ctx.reply(upgradeMsg, {
      link_preview_options: { is_disabled: true },
    })
    return
  }

  // Handle /status
  if (text === '/STATUS' || text === 'STATUS') {
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
        include: {
          cv: true,
          applications: {
            orderBy: { appliedAt: 'desc' },
            take: 5,
          },
          matches: true,
          subscription: true,
        },
      })

      if (!user) {
        await ctx.reply('Please start by sending /start')
        return
      }

      if (!user.cv) {
        await ctx.reply('You have not uploaded your CV yet. Send me your CV as a PDF to get started 📄')
        return
      }

      const isPremium = user.isPremium && user.subscription?.isActive
      const appCount = user.applications.length
      const matchCount = user.matches.length

      let statusMsg = `Your NaijaJobsAI Profile\n\n`
      statusMsg += `Plan: ${isPremium ? '⭐ Premium' : 'Free'}\n`
      statusMsg += `Role: ${user.cv.currentRole || 'Not specified'}\n`
      statusMsg += `Location: ${user.cv.location || 'Not specified'}\n`
      statusMsg += `Experience: ${user.cv.experience} year(s)\n`
      statusMsg += `Skills: ${user.cv.skills.slice(0, 5).join(', ')}\n`
      statusMsg += `Expected salary: ${user.cv.salaryMin ? `N${user.cv.salaryMin.toLocaleString()} - N${user.cv.salaryMax?.toLocaleString()}` : 'Not specified'}\n\n`
      statusMsg += `Stats\n`
      statusMsg += `Total matches: ${matchCount}\n`
      statusMsg += `Applications tracked: ${appCount}\n`
      statusMsg += `Match requests today: ${user.dailyMatchCount}/${isPremium ? 10 : 3}\n`
      statusMsg += `Cover letters today: ${user.dailyCoverCount}/${isPremium ? 'unlimited' : 1}\n\n`

      if (!isPremium) {
        statusMsg += `Upgrade to Premium for ₦3,000/month — reply /upgrade\n\n`
      }

      if (user.applications.length > 0) {
        statusMsg += `Recent Applications\n`
        user.applications.forEach((app) => {
          statusMsg += `- ${app.jobTitle} @ ${app.company} — ${app.status}\n`
        })
      }

      await ctx.reply(statusMsg)
    } catch (error) {
      await ctx.reply('Could not fetch your status. Please try again.')
    }
    return
  }

  // Handle /pause
  if (text === '/PAUSE' || text === 'PAUSE') {
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } })
      if (!user) return
      await prisma.user.update({
        where: { telegramId },
        data: { isActive: false },
      })
      await ctx.reply('⏸ Daily alerts paused. Reply RESUME to turn them back on.')
    } catch (error) {
      await ctx.reply('Could not pause alerts. Please try again.')
    }
    return
  }

  // Handle /resume
  if (text === '/RESUME' || text === 'RESUME') {
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } })
      if (!user) return
      await prisma.user.update({
        where: { telegramId },
        data: { isActive: true },
      })
      await ctx.reply('▶️ Daily alerts resumed! You will receive matches every morning at 8am.')
    } catch (error) {
      await ctx.reply('Could not resume alerts. Please try again.')
    }
    return
  }

  // Handle STATS — admin only
  if (text === 'STATS' && telegramId === process.env.ADMIN_TELEGRAM_ID) {
    try {
      const totalUsers = await prisma.user.count()
      const activeUsers = await prisma.user.count({ where: { isActive: true } })
      const premiumUsers = await prisma.user.count({ where: { isPremium: true } })
      const totalJobs = await prisma.job.count()
      const thisMonth = new Date()
      thisMonth.setDate(1)
      const newUsersThisMonth = await prisma.user.count({
        where: { createdAt: { gte: thisMonth } }
      })
      await ctx.reply(
        `NaijaJobsAI Stats\n\n` +
        `Total users: ${totalUsers}\n` +
        `Active users: ${activeUsers}\n` +
        `Premium users: ${premiumUsers}\n` +
        `New this month: ${newUsersThisMonth}\n` +
        `Jobs in database: ${totalJobs}`
      )
    } catch (error) {
      await ctx.reply('Could not fetch stats. Please try again.')
    }
    return
  }

  

  // Help message for everything else
  await ctx.reply(
    `NaijaJobsAI Commands\n\n` +
    `Send your CV as PDF to get started\n` +
    `NOW — Get job matches immediately\n` +
    `COVER 1/2/3 — Generate cover letter for job 1, 2 or 3\n` +
    `TRACK [company] — Track an application\n` +
    `/upgrade — Upgrade to Premium\n` +
    `/status — View your profile and applications\n` +
    `/pause — Pause daily alerts\n` +
    `/resume — Resume daily alerts`
  )
})

// ==================
// WEBHOOK SERVER
// ==================

// ==================
// WEBHOOK SERVER
// ==================

const app = express()
app.use(express.json())

app.post('/webhook/paystack', createWebhookHandler(bot))
app.use(bot.webhookCallback('/webhook/telegram'))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🌐 Webhook server running on port ${PORT}`)
})

// ==================
// CRON JOBS
// ==================

cron.schedule('0 0,6,12,18 * * *', async () => {
  console.log('🔍 Starting scheduled scrape...')
  try {
    await runAllScrapers()
  } catch (error) {
    console.error('Scrape error:', error)
  }
})

cron.schedule('0 7 * * *', async () => {
  console.log('📬 Sending daily alerts...')
  try {
    await sendDailyAlerts(bot)
  } catch (error) {
    console.error('Alert error:', error)
  }
})

// ==================
// START BOT
// ==================

if (process.env.WEBHOOK_URL) {
  bot.telegram.setWebhook(process.env.WEBHOOK_URL).then(() => {
    console.log('🤖 Telegram webhook set:', process.env.WEBHOOK_URL)
  })
  console.log('🚀 NaijaJobsAI running in webhook mode')
} else {
  bot.launch()
  console.log('🚀 NaijaJobsAI is live in polling mode')
}

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))