import 'dotenv/config'
import { getDB } from '../db/prisma'
import { embedJob, embedCV, buildJobText, buildCVText, generateEmbedding } from '../ai/embeddings'

async function backfillEmbeddings() {
  const prisma = getDB()
  console.log('🚀 Starting embedding backfill...')
  console.log('================================')

  // ─────────────────────────────────────────────
  // Backfill Jobs
  // ─────────────────────────────────────────────
  const jobsToEmbed = await prisma.$queryRaw<any[]>`
  SELECT id, title, company, location, sector, skills, description, salary
  FROM "Job"
  WHERE "isActive" = true
  AND (embedding IS NULL OR array_length(embedding, 1) IS NULL)
  ORDER BY "postedAt" DESC
`

  console.log(`📋 Jobs to embed: ${jobsToEmbed.length}`)

  let jobsDone = 0
  let jobsFailed = 0

  for (const job of jobsToEmbed) {
    try {
      const text = buildJobText(job)
      const vector = await generateEmbedding(text)

      await prisma.job.update({
        where: { id: job.id },
        data: { embedding: vector },
      })

      jobsDone++

      if (jobsDone % 10 === 0) {
        console.log(`✅ Jobs embedded: ${jobsDone}/${jobsToEmbed.length}`)
      }

      // Small delay to avoid OpenAI rate limits
      await new Promise(r => setTimeout(r, 200))

    } catch (error) {
      console.error(`❌ Failed to embed job ${job.id} (${job.title}):`, error)
      jobsFailed++
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  console.log(`✅ Jobs complete: ${jobsDone} embedded, ${jobsFailed} failed`)

  // ─────────────────────────────────────────────
  // Backfill CVs
  // ─────────────────────────────────────────────
  const cvsToEmbed = await prisma.$queryRaw<any[]>`
  SELECT "userId", "currentRole", skills, experience, location, sectors, education, summary
  FROM "CV"
  WHERE embedding IS NULL OR array_length(embedding, 1) IS NULL
`

  console.log(`\n📋 CVs to embed: ${cvsToEmbed.length}`)

  let cvsDone = 0
  let cvsFailed = 0

  for (const cv of cvsToEmbed) {
    try {
      const text = buildCVText(cv)
      const vector = await generateEmbedding(text)

      await prisma.cV.update({
        where: { userId: cv.userId },
        data: { embedding: vector },
      })

      cvsDone++
      console.log(`✅ CV embedded for user ${cv.userId}`)

      await new Promise(r => setTimeout(r, 200))

    } catch (error) {
      console.error(`❌ Failed to embed CV for user ${cv.userId}:`, error)
      cvsFailed++
    }
  }

  console.log(`✅ CVs complete: ${cvsDone} embedded, ${cvsFailed} failed`)

  console.log('\n================================')
  console.log('✅ Backfill complete!')
  console.log(`   Jobs: ${jobsDone} embedded`)
  console.log(`   CVs:  ${cvsDone} embedded`)
  console.log('\nVector matching is now active for all users.')
}

backfillEmbeddings()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill error:', error)
    process.exit(1)
  })