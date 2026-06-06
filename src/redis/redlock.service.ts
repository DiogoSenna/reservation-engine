import { Injectable, OnModuleInit } from '@nestjs/common'
import Redlock, { type Lock } from 'redlock'
import { RedisService } from './redis.service'

@Injectable()
export class RedlockService implements OnModuleInit {
  private redlock!: Redlock

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    this.redlock = new Redlock([this.redis], {
      retryCount: 3,
      retryDelay: 200,
      retryJitter: 100,
    })
  }

  async lock(resource: string, ttl: number): Promise<Lock> {
    return this.redlock.lock(resource, ttl)
  }
}
