import { Module } from '@nestjs/common'
import { EventsService } from './events.service'
import { EventsController } from './events.controller'
import { ReservationModule } from '../reservation/reservation.module'
import { RateLimitModule } from '../rate-limit/rate-limit.module'

@Module({
  imports: [ReservationModule, RateLimitModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
