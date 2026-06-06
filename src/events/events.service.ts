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

  async findAll() {
    const events = await this.prisma.event.findMany({
      where: { status: { not: 'cancelled' } },
      orderBy: { eventDate: 'asc' },
    })
    return Promise.all(events.map((e) => this.withInventory(e)))
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

  private async withInventory(event: any) {
    const key = `event:${event.id}:inventory`
    // Initialize the key atomically if not present (covers seeded events)
    await this.redis.set(key, event.totalCapacity, 'NX')
    const inv = await this.redis.get(key)
    return { ...event, availableTickets: inv !== null ? parseInt(inv) : event.totalCapacity }
  }
}
