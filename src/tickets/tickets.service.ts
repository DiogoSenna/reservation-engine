import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  findMine(userId: string) {
    return this.prisma.ticket.findMany({
      where: { userId, status: 'confirmed' },
      include: { event: true },
      orderBy: { purchasedAt: 'desc' },
    })
  }
}
