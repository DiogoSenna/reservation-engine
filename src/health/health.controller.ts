import { Controller, Get, Res } from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { PrismaService } from '../database/prisma.service'
import { RedisService } from '../redis/redis.service'
import { MetricsService } from '../metrics/metrics.service'

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('health')
  async health() {
    const [dbOk, redisOk] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ])
    return {
      status: 'ok',
      postgres: dbOk.status === 'fulfilled' ? 'up' : 'down',
      redis: redisOk.status === 'fulfilled' ? 'up' : 'down',
    }
  }

  @Get('metrics')
  async metricsEndpoint(@Res() reply: FastifyReply) {
    reply.header('Content-Type', this.metrics.register.contentType)
    reply.send(await this.metrics.register.metrics())
  }
}
