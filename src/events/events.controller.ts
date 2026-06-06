import {
  Controller, Get, Post, Put, Delete,
  Param, Body, HttpCode, UseGuards,
  ConflictException, UnauthorizedException, HttpException,
} from '@nestjs/common'
import { EventsService } from './events.service'
import { CreateEventDto } from './dto/create-event.dto'
import { UpdateEventDto } from './dto/update-event.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { RateLimitGuard } from '../rate-limit/rate-limit.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { ReservationService } from '../reservation/reservation.service'
import { PrismaService } from '../database/prisma.service'
import type { JwtPayload } from '../../types'

@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly reservation: ReservationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  findAll() { return this.events.findAll() }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.events.findOne(id) }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(201)
  create(@Body() dto: CreateEventDto) { return this.events.create(dto) }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto)
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(204)
  cancel(@Param('id') id: string) { return this.events.cancel(id) }

  @Post(':id/purchase')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  async purchase(
    @Param('id') eventId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const event = await this.events.findOne(eventId)
    if (event.status !== 'active') {
      throw new ConflictException('Event is not available')
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } })
    if (!dbUser) throw new UnauthorizedException('User not found')

    const outcome = await this.reservation.purchase({
      userId: user.sub,
      eventId: event.id,
      eventPrice: Number(event.price),
      cardToken: dbUser.cardToken,
    })

    if ('error' in outcome) {
      const statusMap: Record<string, number> = {
        sold_out: 409, duplicate: 409, lock_timeout: 409, payment_failed: 402,
      }
      throw new HttpException({ error: outcome.error }, statusMap[outcome.error] ?? 500)
    }

    return outcome
  }
}
