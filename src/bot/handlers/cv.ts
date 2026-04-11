import { Context } from 'telegraf'
import axios from 'axios'
import * as pdfParse from 'pdf-parse'
const pdf = (pdfParse as any).default || pdfParse
import { getDB } from '../../db/prisma'
import { extractCVData } from '../../ai/parseCV'
import { embedCV } from '../../ai/embeddings' // ← NEW

export async function handleDocument(ctx: Context) {
  const telegramId = ctx.from?.id.toString()
  if (!telegramId) return

  // @ts-ignore
  const document = ctx.message?.document
  if (!document) return

  if (document.mime_type !== 'application/pdf') {
    await ctx.reply(
      '⚠️ Please send your CV as a *PDF file* only.\n\n' +
      'If your CV is in Word format, convert it to PDF first.',
      { parse_mode: 'Markdown' }
    )
    return
  }

  if (document.file_size > 5 * 1024 * 1024) {
    await ctx.reply('⚠️ Your CV file is too large. Please send a PDF under 5MB.')
    return
  }

  await ctx.reply('📄 Got your CV! Give me a moment to read through it...')

  try {
    const prisma = getDB()

    const fileLink = await ctx.telegram.getFileLink(document.file_id)
    const fileUrl = fileLink.href

    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' })
    const pdfBuffer = Buffer.from(response.data)

    const pdfData = await pdf(pdfBuffer)
    const rawText = pdfData.text

    if (!rawText || rawText.trim().length < 50) {
      await ctx.reply(
        '⚠️ I could not read your PDF. This sometimes happens with scanned CVs.\n\n' +
        'Please make sure your CV is a text-based PDF (not a scanned image) and try again.'
      )
      return
    }

    await ctx.reply('🤖 Analysing your CV with AI...')

    const cvData = await extractCVData(rawText)

    const user = await prisma.user.findUnique({ where: { telegramId } })
    if (!user) return

    await prisma.cV.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        rawText,
        skills: cvData.skills,
        experience: cvData.experience,
        currentRole: cvData.currentRole,
        location: cvData.location,
        sectors: cvData.sectors,
        salaryMin: cvData.salaryMin,
        salaryMax: cvData.salaryMax,
        education: cvData.education,
        summary: cvData.summary,
      },
      update: {
        rawText,
        skills: cvData.skills,
        experience: cvData.experience,
        currentRole: cvData.currentRole,
        location: cvData.location,
        sectors: cvData.sectors,
        salaryMin: cvData.salaryMin,
        salaryMax: cvData.salaryMax,
        education: cvData.education,
        summary: cvData.summary,
      },
    })

    // ── Embed CV in background — don't block the user response ──
    embedCV(user.id).catch((err) =>
      console.error('CV embedding failed (non-critical):', err)
    )

    await ctx.reply(
      `✅ *CV analysed successfully!*\n\n` +
      `Here's what I found:\n\n` +
      `👤 *Role:* ${cvData.currentRole || 'Not specified'}\n` +
      `📍 *Location:* ${cvData.location || 'Not specified'}\n` +
      `💼 *Experience:* ${cvData.experience} year(s)\n` +
      `🛠 *Skills:* ${cvData.skills.slice(0, 6).join(', ')}\n` +
      `🏭 *Sectors:* ${cvData.sectors.join(', ')}\n` +
      `💰 *Expected salary:* ${cvData.salaryMin ? `₦${cvData.salaryMin.toLocaleString()} - ₦${cvData.salaryMax?.toLocaleString()}` : 'Not specified'}\n\n` +
      `🎯 *You're all set!* Your first job matches will arrive tomorrow morning at 8am.\n\n` +
      `Want to see jobs right now? Reply *NOW* and I'll send your first matches immediately.`,
      { parse_mode: 'Markdown' }
    )

  } catch (error) {
    console.error('CV handler error:', error)
    await ctx.reply(
      '⚠️ Something went wrong reading your CV. Please try again.\n\n' +
      'If the problem persists, make sure your PDF is not password protected.'
    )
  }
}