import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../database/prisma.service'
import type { JwtPayload } from '../../types'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) return null
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return null
    return user
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password)
    if (!user) return null
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role as 'user' | 'admin' }
    const token = this.jwt.sign(payload)
    return { token, user: { id: user.id, email: user.email, role: user.role } }
  }
}
