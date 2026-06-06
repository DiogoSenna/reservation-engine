import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { DECR_INVENTORY, SLIDING_WINDOW } from './scripts'
import type { AppConfig } from '../config/configuration'

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  readonly scripts: { decrInventory: string; slidingWindow: string }

  constructor(configService: ConfigService<AppConfig>) {
    super(configService.get('REDIS_URL', { infer: true })!, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    this.scripts = {
      decrInventory: DECR_INVENTORY,
      slidingWindow: SLIDING_WINDOW,
    }
    this.on('error', (err) => console.error('Redis error:', err))
  }

  async onModuleInit() {
    await this.connect()
  }

  async onModuleDestroy() {
    this.disconnect()
  }
}
