import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import * as bcrypt from 'bcrypt'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10)

  await prisma.user.createMany({
    data: [
      { email: 'admin@example.com', passwordHash, cardToken: 'tok_admin', role: 'admin' },
      ...Array.from({ length: 20 }, (_, i) => ({
        email: `user${i + 1}@example.com`,
        passwordHash,
        cardToken: `tok_visa_user${i + 1}`,
        role: 'user' as const,
      })),
    ],
    skipDuplicates: true,
  })

  await prisma.event.createMany({
    data: [
      {
        name: 'Arctic Monkeys — Glastonbury 2026',
        venue: 'Pyramid Stage, Glastonbury',
        eventDate: new Date('2026-06-26T21:00:00Z'),
        totalCapacity: 10,
        price: 299.99,
      },
      {
        name: 'Radiohead Reunion Tour — London',
        venue: 'O2 Arena, London',
        eventDate: new Date('2026-09-15T19:30:00Z'),
        totalCapacity: 50,
        price: 149.99,
      },
    ],
    skipDuplicates: true,
  })

  console.log('Seed complete')
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
