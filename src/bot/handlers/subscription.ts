import prisma from '../../db/prisma'

const FREE_MATCH_LIMIT = 3
const FREE_COVER_LIMIT = 1
const PREMIUM_MATCH_LIMIT = 10
const PREMIUM_COVER_LIMIT = 20
const PREMIUM_PRICE = 3000

export async function checkAndResetUsage(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return

  const now = new Date()
  const lastReset = new Date(user.lastUsageReset)
  const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60)

  // Reset counts every 24 hours
  if (hoursSinceReset >= 24) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        dailyMatchCount: 0,
        dailyCoverCount: 0,
        lastUsageReset: now,
      },
    })
  }
}

export async function canRequestMatch(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  })
  if (!user) return { allowed: false, reason: 'User not found' }

  await checkAndResetUsage(userId)

  // Re-fetch after reset
  const fresh = await prisma.user.findUnique({ where: { id: userId } })
  if (!fresh) return { allowed: false }

  const isPremium = user.isPremium && user.subscription?.isActive &&
    user.subscription.endDate && new Date(user.subscription.endDate) > new Date()

  const limit = isPremium ? PREMIUM_MATCH_LIMIT : FREE_MATCH_LIMIT

  if (fresh.dailyMatchCount >= limit) {
    if (isPremium) {
      return {
        allowed: false,
        reason: `You have reached your daily limit of ${PREMIUM_MATCH_LIMIT} match requests. Come back tomorrow!`,
      }
    }
    return {
      allowed: false,
      reason: `You have used your ${FREE_MATCH_LIMIT} free match requests today.\n\nUpgrade to Premium for up to ${PREMIUM_MATCH_LIMIT} requests/day, unlimited cover letters and top 5 job matches.\n\nReply /upgrade to get started — only ₦${PREMIUM_PRICE.toLocaleString()}/month.`,
    }
  }

  return { allowed: true }
}

export async function canRequestCover(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  })
  if (!user) return { allowed: false, reason: 'User not found' }

  await checkAndResetUsage(userId)

  const fresh = await prisma.user.findUnique({ where: { id: userId } })
  if (!fresh) return { allowed: false }

  const isPremium = user.isPremium && user.subscription?.isActive &&
    user.subscription.endDate && new Date(user.subscription.endDate) > new Date()

  const limit = isPremium ? PREMIUM_COVER_LIMIT : FREE_COVER_LIMIT

  if (fresh.dailyCoverCount >= limit) {
    if (isPremium) {
      return {
        allowed: false,
        reason: `You have reached your daily cover letter limit. Come back tomorrow!`,
      }
    }
    return {
      allowed: false,
      reason: `You have used your ${FREE_COVER_LIMIT} free cover letter today.\n\nUpgrade to Premium for unlimited cover letters every day.\n\nReply /upgrade to get started — only ₦${PREMIUM_PRICE.toLocaleString()}/month.`,
    }
  }

  return { allowed: true }
}

export async function incrementMatchCount(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { dailyMatchCount: { increment: 1 } },
  })
}

export async function incrementCoverCount(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { dailyCoverCount: { increment: 1 } },
  })
}

export function getUpgradeMessage(): string {
    const paymentUrl = process.env.PAYSTACK_PAYMENT_URL || 'https://paystack.shop/pay/naijajobs-premium'
    return `⭐ NaijaJobsAI Premium — ₦${PREMIUM_PRICE.toLocaleString()}/month\n\n` +
      `Free tier:\n` +
      `• 3 job match requests/day\n` +
      `• 1 cover letter/day\n` +
      `• Top 3 job matches\n\n` +
      `Premium tier:\n` +
      `• 10 job match requests/day\n` +
      `• Unlimited cover letters\n` +
      `• Top 5 job matches\n` +
      `• Priority matching\n\n` +
      `To upgrade click the link below:\n` +
      `${paymentUrl}\n\n` +
      `When paying enter your Telegram username and Telegram ID so we can activate your account automatically.\n\n` +
      `Your Telegram ID is: {TELEGRAM_ID}\n\n` +
      `After payment your account will be activated within minutes.`
  }