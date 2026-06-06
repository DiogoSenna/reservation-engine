import { Module } from '@nestjs/common'
import { ReservationService } from './reservation.service'
import { PaymentModule } from '../payment/payment.module'

@Module({
  imports: [PaymentModule],
  providers: [ReservationService],
  exports: [ReservationService],
})
export class ReservationModule {}
