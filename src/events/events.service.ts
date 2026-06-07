import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { RedisService } from '../redis/redis.service'
import { CreateEventDto } from './dto/create-event.dto'
import { UpdateEventDto } from './dto/update-event.dto'

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findAll(userId?: string) {
    const [events, purchasedEventIds] = await Promise.all([
      this.prisma.event.findMany({
        where: { status: { not: 'cancelled' } },
        orderBy: { eventDate: 'asc' },
      }),
      userId
        ? this.prisma.ticket
            .findMany({ where: { userId, status: 'confirmed' }, select: { eventId: true } })
            .then((tickets) => new Set(tickets.map((t) => t.eventId)))
        : Promise.resolve(new Set<string>()),
    ])

    return Promise.all(
      events.map((e) => this.withInventory(e, purchasedEventIds.has(e.id))),
    )
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } })
    if (!event) throw new NotFoundException('Event not found')
    return this.withInventory(event)
  }

  async create(dto: CreateEventDto) {
    const event = await this.prisma.event.create({
      data: {
        name: dto.name,
        venue: dto.venue,
        eventDate: new Date(dto.eventDate),
        totalCapacity: dto.totalCapacity,
        price: dto.price,
      },
    })
    await this.redis.set(`event:${event.id}:inventory`, event.totalCapacity)
    return event
  }

  async update(id: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({ where: { id } })
    if (!event) throw new NotFoundException('Event not found')
    if (event.status === 'cancelled') throw new ConflictException('Cannot update a cancelled event')

    return this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.venue && { venue: dto.venue }),
        ...(dto.eventDate && { eventDate: new Date(dto.eventDate) }),
        ...(dto.price && { price: dto.price }),
      },
    })
  }

  async cancel(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } })
    if (!event) throw new NotFoundException('Event not found')

    await this.prisma.$transaction([
      this.prisma.ticket.updateMany({
        where: { eventId: id, status: 'pending' },
        data: { status: 'cancelled' },
      }),
      this.prisma.event.update({ where: { id }, data: { status: 'cancelled' } }),
    ])

    await this.redis.del(`event:${id}:inventory`)
  }

  private async withInventory(event: any, userHasPurchased = false) {
    const key = `event:${event.id}:inventory`
    await this.redis.set(key, event.totalCapacity, 'NX')
    const inv = await this.redis.get(key)
    return {
      ...event,
      availableTickets: inv !== null ? parseInt(inv) : event.totalCapacity,
      userHasPurchased,
    }
  }
}
