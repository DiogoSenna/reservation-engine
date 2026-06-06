import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig } from '../config/configuration'

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  readonly scripts: { decrInventory: string; slidingWindow: string }

  constructor(private readonly config: ConfigService<AppConfig>) {
    super(config.get('REDIS_URL', { infer: true })!, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    const scriptsDir = join(__dirname, 'scripts')
    this.scripts = {
      decrInventory: readFileSync(join(scriptsDir, 'decr-inventory.lua'), 'utf-8'),
      slidingWindow: readFileSync(join(scriptsDir, 'sliding-window.lua'), 'utf-8'),
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
