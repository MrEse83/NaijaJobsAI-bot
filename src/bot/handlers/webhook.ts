import { Request, Response } from 'express'
import crypto from 'crypto'
import { Telegraf } from 'telegraf'
import { getDB } from '../../db/prisma'

// bot is passed in from index.ts — no duplicate instance created here
export function createWebhookHandler(bot: Telegraf) {
  return async function handlePaystackWebhook(req: Request, res: Response) {
    const secret = process.env.PAYSTACK_SECRET_KEY!
    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(req.body))
      .digest('hex')

    if (hash !== req.headers['x-paystack-signature']) {
      console.log('Invalid webhook signature')
      return res.status(401).send('Unauthorized')
    }

    const event = req.body

    if (event.event === 'charge.success') {
      const data = event.data
      const amount = data.amount / 100 // Paystack sends in kobo
      const customerEmail = data.customer?.email
      const metadata = data.metadata?.custom_fields || []

      console.log('Payment received:', { amount, customerEmail, metadata })

      // Extract Telegram ID from custom fields
      let telegramId = ''
      for (const field of metadata) {
        if (
          field.variable_name === 'telegram_id' ||
          field.display_name?.toLowerCase().includes('telegram id')
        ) {
          telegramId = field.value?.toString().trim()
        }
      }

      if (!telegramId) {
        console.log('No Telegram ID found in payment metadata')
        const adminId = process.env.ADMIN_TELEGRAM_ID
        if (adminId) {
          await bot.telegram.sendMessage(
            adminId,
            `💰 Payment received but no Telegram ID found!\n\n` +
            `Email: ${customerEmail}\n` +
            `Amount: ₦${amount.toLocaleString()}\n\n` +
            `Manually activate with: ACTIVATE [telegramId]`
          )
        }
        return res.status(200).send('OK')
      }

      try {
        const prisma = getDB()
        const user = await prisma.user.findUnique({ where: { telegramId } })

        if (!user) {
          console.log('User not found for telegramId:', telegramId)
          const adminId = process.env.ADMIN_TELEGRAM_ID
          if (adminId) {
            await bot.telegram.sendMessage(
              adminId,
              `💰 Payment received but user not found!\n\n` +
              `Telegram ID: ${telegramId}\n` +
              `Email: ${customerEmail}\n` +
              `Amount: ₦${amount.toLocaleString()}`
            )
          }
          return res.status(200).send('OK')
        }

        // Activate premium
        const endDate = new Date()
        endDate.setMonth(endDate.getMonth() + 1)

        await prisma.user.update({
          where: { telegramId },
          data: { isPremium: true },
        })

        await prisma.subscription.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            paystackRef: data.reference,
            plan: 'premium',
            amount: 3000,
            startDate: new Date(),
            endDate,
            isActive: true,
          },
          update: {
            paystackRef: data.reference,
            plan: 'premium',
            amount: 3000,
            startDate: new Date(),
            endDate,
            isActive: true,
          },
        })

        // Notify user
        await bot.telegram.sendMessage(
          telegramId,
          `🌟 Your NaijaJobsAI Premium is now active!\n\n` +
          `You now have:\n` +
          `• 10 match requests per day\n` +
          `• Unlimited cover letters\n` +
          `• Top 5 job matches\n` +
          `• Premium expires: ${endDate.toDateString()}\n\n` +
          `Reply NOW to get your premium matches!`
        )

        // Notify admin
        const adminId = process.env.ADMIN_TELEGRAM_ID
        if (adminId) {
          await bot.telegram.sendMessage(
            adminId,
            `✅ Premium activated!\n\n` +
            `User: ${user.name || telegramId}\n` +
            `Amount: ₦${amount.toLocaleString()}\n` +
            `Expires: ${endDate.toDateString()}`
          )
        }

        console.log(`✅ Premium activated for ${telegramId}`)

      } catch (error) {
        console.error('Webhook activation error:', error)
      }
    }

    res.status(200).send('OK')
  }
}