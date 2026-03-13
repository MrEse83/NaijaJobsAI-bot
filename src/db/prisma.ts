import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

let _prisma: PrismaClient | null = null

export function getDB(): PrismaClient {
  if (_prisma) return _prisma

  const connectionString = process.env.DATABASE_URL!
  console.log('Creating PG pool, URL:', connectionString ? 'FOUND' : 'MISSING')

  const pool = new Pool({ connectionString })
  const adapter = new PrismaPg(pool)

  // @ts-ignore
  _prisma = new PrismaClient({ adapter, log: ['error'] })
  return _prisma
}

export const prisma = {
  get user() { return getDB().user },
  get cV() { return getDB().cV },
  get job() { return getDB().job },
  get jobMatch() { return getDB().jobMatch },
  get application() { return getDB().application },
  get subscription() { return getDB().subscription },
  $disconnect: () => getDB().$disconnect(),
  $connect: () => getDB().$connect(),
}

export default prisma