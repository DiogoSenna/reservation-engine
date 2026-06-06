import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { configuration } from './config/configuration'
import { PrismaModule } from './database/prisma.module'
import { RedisModule } from './redis/redis.module'
import { MetricsModule } from './metrics/metrics.module'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { EventsModule } from './events/events.module'

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    PrismaModule,
    RedisModule,
    MetricsModule,
    HealthModule,
    AuthModule,
    EventsModule,
  ],
})
export class AppModule {}
