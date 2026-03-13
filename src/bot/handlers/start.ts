import { Context } from 'telegraf'
import prisma from '../../db/prisma'

export async function handleStart(ctx: Context) {
  const telegramId = ctx.from?.id.toString()
  const name = ctx.from?.first_name || 'there'
  const telegramHandle = ctx.from?.username

  if (!telegramId) return

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { telegramId },
      include: { cv: true },
    })

    if (existingUser?.cv) {
      // Returning user with CV
      await ctx.reply(
        `Welcome back ${name}! 👋\n\n` +
        `You're all set up. Your daily job alerts are active.\n\n` +
        `What would you like to do?\n` +
        `📄 Send a new CV to update your profile\n` +
        `/status — View your current profile\n` +
        `/premium — Upgrade for unlimited alerts\n` +
        `/help — See all commands`
      )
      return
    }

    if (existingUser && !existingUser.cv) {
      // User exists but no CV yet
      await ctx.reply(
        `Welcome back ${name}! 👋\n\n` +
        `You haven't uploaded your CV yet.\n` +
        `Send me your CV as a PDF file to get started 📄`
      )
      return
    }

    // New user — create account
    await prisma.user.create({
      data: {
        telegramId,
        telegramHandle,
        name,
      },
    })

    await ctx.reply(
  `🇳🇬 Welcome to <b>NaijaJobsAI</b>, ${name}!\n\n` +
  `I match jobs directly to your skills and experience — ` +
  `no more scrolling through hundreds of irrelevant listings.\n\n` +
  `<b>Here's how it works:</b>\n` +
  `1️⃣ Send me your CV as a PDF\n` +
  `2️⃣ I read your skills, experience &amp; location\n` +
  `3️⃣ Every morning at 8am, I send you your top 3 matching jobs\n` +
  `4️⃣ Reply to any job for a custom cover letter\n\n` +
  `<b>To get started — send me your CV as a PDF file now</b> 👇`,
  { parse_mode: 'HTML' }
)

  } catch (error) {
    console.error('Start handler error:', error)
    await ctx.reply('Something went wrong. Please try again.')
  }
}