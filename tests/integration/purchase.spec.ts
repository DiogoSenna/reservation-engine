import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ValidationPipe } from '@nestjs/common'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import { execSync } from 'child_process'

describe('Purchase flow — concurrency correctness', () => {
  let app: NestFastifyApplication
  let stopContainers: () => Promise<void>

  beforeAll(async () => {
    const [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ])

    process.env.DATABASE_URL = pg.getConnectionUri()
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`
    process.env.JWT_SECRET = 'integration-test-secret-32chars!!'
    process.env.JWT_EXPIRY = '8h'
    process.env.PAYMENT_SUCCESS_RATE = '1'
    process.env.PAYMENT_MIN_LATENCY_MS = '0'
    process.env.PAYMENT_MAX_LATENCY_MS = '0'
    process.env.PAYMENT_FAILURE_MODES = 'card_declined'
    process.env.NODE_ENV = 'test'

    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'inherit' })
    execSync('npx tsx scripts/seed.ts', { env: process.env, stdio: 'inherit' })

    // Dynamic import ensures env vars are set before NestJS modules initialize
    const { AppModule } = await import('../../src/app.module')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    stopContainers = async () => {
      await pg.stop()
      await redis.stop()
    }
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await stopContainers?.()
  })

  it('confirms exactly totalCapacity tickets and rejects the rest as sold_out', async () => {
    // Login all 20 users
    const tokens = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: `user${i + 1}@example.com`, password: 'password123' },
        })
        return JSON.parse(res.body).token as string
      }),
    )

    // Find the small event (capacity 10)
    const eventsRes = await app.inject({ method: 'GET', url: '/events' })
    const events = JSON.parse(eventsRes.body) as Array<{ id: string; totalCapacity: number }>
    const smallEvent = events.find((e) => e.totalCapacity === 10)
    expect(smallEvent).toBeDefined()

    // Fire 20 concurrent purchases — different users so duplicate guard doesn't interfere
    const results = await Promise.all(
      tokens.map((token) =>
        app.inject({
          method: 'POST',
          url: `/events/${smallEvent!.id}/purchase`,
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    )

    const confirmed = results.filter((r) => r.statusCode === 201)
    const soldOut = results.filter((r) => r.statusCode === 409)
    const other = results.filter((r) => r.statusCode !== 201 && r.statusCode !== 409)

    console.log(`confirmed=${confirmed.length} sold_out=${soldOut.length} other=${other.length}`)
    if (other.length > 0) {
      console.log('Unexpected responses:', other.map((r) => ({ status: r.statusCode, body: r.body })))
    }

    expect(confirmed.length).toBe(10)
    expect(soldOut.length).toBe(10)
    expect(other.length).toBe(0)
  }, 30_000)
})
