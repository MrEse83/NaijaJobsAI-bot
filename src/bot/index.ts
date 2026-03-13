import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { handleStart } from './handlers/start'
import { handleDocument } from './handlers/cv'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

// Commands
bot.start(handleStart)

// CV upload — when user sends a document/PDF
bot.on(message('document'), handleDocument)

// Handle text messages
bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text.toLowerCase().trim()

  if (text === 'help' || text === '/help') {
    await ctx.reply(
      `🤖 *NaijaJobsAI Commands*\n\n` +
      `/start — Get started\n` +
      `📄 Send your CV as PDF to activate job alerts\n` +
      `COVER [n] — Generate cover letter for job n\n` +
      `/status — View your profile\n` +
      `/premium — Upgrade to premium\n` +
      `/pause — Pause daily alerts\n` +
      `/resume — Resume daily alerts\n`,
      { parse_mode: 'Markdown' }
    )
  }
})

bot.launch()
console.log('🚀 NaijaJobsAI bot is running...')

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

export default bot