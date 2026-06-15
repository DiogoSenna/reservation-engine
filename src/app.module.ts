import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { configuration } from './config/configuration'
import { PrismaModule } from './database/prisma.module'
import { RedisModule } from './redis/redis.module'
import { MetricsModule } from './metrics/metrics.module'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { EventsModule } from './events/events.module'
import { TicketsModule } from './tickets/tickets.module'
import { WebhooksModule } from './webhooks/webhooks.module'

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    PrismaModule,
    RedisModule,
    MetricsModule,
    HealthModule,
    AuthModule,
    EventsModule,
    TicketsModule,
    WebhooksModule,
  ],
})
export class AppModule {}
