import { Test } from '@nestjs/testing'
import { RateLimitService } from '../../src/rate-limit/rate-limit.service'
import { RedisService } from '../../src/redis/redis.service'

describe('RateLimitService', () => {
  let service: RateLimitService
  const mockRedis = { eval: vi.fn(), scripts: { slidingWindow: 'script' } }

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RateLimitService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile()
    service = module.get(RateLimitService)
    vi.clearAllMocks()
  })

  it('returns allowed=true when Lua returns 1', async () => {
    mockRedis.eval.mockResolvedValue(1)
    const result = await service.check({ key: 'user:1', windowMs: 60000, maxRequests: 10 })
    expect(result.allowed).toBe(true)
  })

  it('returns allowed=false when Lua returns 0', async () => {
    mockRedis.eval.mockResolvedValue(0)
    const result = await service.check({ key: 'user:1', windowMs: 60000, maxRequests: 10 })
    expect(result.allowed).toBe(false)
  })
})
