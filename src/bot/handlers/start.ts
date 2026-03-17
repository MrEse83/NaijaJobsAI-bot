import { Context } from 'telegraf'
import { getDB } from '../../db/prisma'

export async function handleStart(ctx: Context) {
  const telegramId = ctx.from?.id.toString()
  const name = ctx.from?.first_name || 'there'
  const telegramHandle = ctx.from?.username

  if (!telegramId) return

  const prisma = getDB()

  try {
    const existingUser = await prisma.user.findUnique({
      where: { telegramId },
      include: { cv: true },
    })

    // ── Returning user with CV ──
    if (existingUser?.cv) {
      await ctx.reply(
        `Welcome back ${name}! 👋\n\n` +
        `Your daily job alerts are active — I'll send your top matches at 8am every morning.\n\n` +
        `Want matches right now? Reply <b>NOW</b>\n` +
        `View your profile? Reply <b>/status</b>\n` +
        `Update your CV? Send me a new PDF 📄`,
        { parse_mode: 'HTML' }
      )
      return
    }

    // ── Returning user without CV ──
    if (existingUser && !existingUser.cv) {
      await ctx.reply(
        `Welcome back ${name}! 👋\n\n` +
        `You're one step away — just send me your CV as a PDF and I'll start finding matching jobs for you immediately 📄`,
        { parse_mode: 'HTML' }
      )
      return
    }

    // ── New user — create account ──
    await prisma.user.create({
      data: {
        telegramId,
        telegramHandle,
        name,
      },
    })

    // Get live job count for social proof
    const jobCount = await prisma.job.count({ where: { isActive: true } })
    const userCount = await prisma.user.count()
    const jobCountText = jobCount > 0 ? `${jobCount.toLocaleString()}+` : '500+'
    const userCountText = userCount > 1 ? `${userCount.toLocaleString()} Nigerians` : 'Nigerians'

    await ctx.reply(
      `🇳🇬 <b>Welcome to NaijaJobsAI, ${name}!</b>\n\n` +
      `I'm an AI that reads your CV and sends you only the jobs that actually match your skills — no more scrolling through hundreds of irrelevant listings on Jobberman.\n\n` +
      `<b>Already used by ${userCountText} • ${jobCountText} active jobs</b>\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `<b>Here's how it works:</b>\n\n` +
      `📄 <b>Step 1</b> — Send me your CV as a PDF\n` +
      `🤖 <b>Step 2</b> — I analyse your skills, experience & location\n` +
      `🎯 <b>Step 3</b> — Get your top 3 matching jobs immediately\n` +
      `✍️ <b>Step 4</b> — Request a custom cover letter for any job\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `<b>It takes less than 30 seconds to get started.</b>\n\n` +
      `👇 <b>Send me your CV as a PDF now</b>`,
      { parse_mode: 'HTML' }
    )

    // Send a follow-up message after 3 seconds to nudge them
    await new Promise(r => setTimeout(r, 3000))
    await ctx.reply(
      `💡 <b>Tip:</b> Make sure your CV is a text-based PDF (not a scanned image) for best results.\n\n` +
      `If your CV is in Word format, convert it at <b>smallpdf.com</b> — it's free and takes 10 seconds.`,
      { parse_mode: 'HTML' }
    )

  } catch (error) {
    console.error('Start handler error:', error)
    await ctx.reply('Something went wrong. Please try again.')
  }
}