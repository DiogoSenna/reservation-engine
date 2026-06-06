import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { RedisService } from '../redis/redis.service'

interface CheckOptions {
  key: string
  windowMs: number
  maxRequests: number
}

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async check({ key, windowMs, maxRequests }: CheckOptions) {
    const result = await this.redis.eval(
      this.redis.scripts.slidingWindow,
      1, key,
      Date.now().toString(),
      windowMs.toString(),
      maxRequests.toString(),
      randomUUID(),
    ) as number

    return { allowed: result === 1, retryAfterMs: result === 0 ? windowMs : 0 }
  }
}
