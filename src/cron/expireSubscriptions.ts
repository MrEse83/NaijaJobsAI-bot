import { Telegraf } from 'telegraf'
import { getDB } from '../db/prisma'

export async function expirePremiumSubscriptions(bot: Telegraf): Promise<void> {
  console.log('🔍 Checking for expired premium subscriptions...')
  const prisma = getDB()

  const now = new Date()

  // Find all users who are marked isPremium=true
  // but whose subscription endDate has passed
  const expiredUsers = await prisma.user.findMany({
    where: {
      isPremium: true,
      subscription: {
        endDate: { lt: now },
        isActive: true,
      },
    },
    include: { subscription: true },
  })

  if (expiredUsers.length === 0) {
    console.log('No expired subscriptions found.')
    return
  }

  console.log(`Found ${expiredUsers.length} expired premium subscription(s)`)

  for (const user of expiredUsers) {
    try {
      // Downgrade user
      await prisma.user.update({
        where: { id: user.id },
        data: { isPremium: false },
      })

      // Mark subscription as inactive
      await prisma.subscription.update({
        where: { userId: user.id },
        data: { isActive: false },
      })

      // Notify the user
      await bot.telegram.sendMessage(
        user.telegramId,
        `Your NaijaJobsAI Premium has expired.\n\n` +
        `You've been moved back to the free plan:\n` +
        `• 3 job match requests/day\n` +
        `• 1 cover letter/day\n` +
        `• Top 3 job matches\n\n` +
        `To renew for another month reply /upgrade — only ₦3,000.`
      )

      console.log(`✅ Expired premium for user ${user.telegramId}`)
    } catch (error) {
      console.error(`Failed to expire subscription for ${user.telegramId}:`, error)
    }
  }

  console.log(`✅ Subscription expiry complete — ${expiredUsers.length} user(s) downgraded`)
}