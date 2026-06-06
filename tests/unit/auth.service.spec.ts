import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from '../../src/auth/auth.service'
import { PrismaService } from '../../src/database/prisma.service'
import * as bcrypt from 'bcrypt'

describe('AuthService', () => {
  let service: AuthService

  const mockPrisma = { user: { findUnique: vi.fn() } }
  const mockJwt = { sign: vi.fn().mockReturnValue('token') }

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile()
    service = module.get(AuthService)
    vi.clearAllMocks()
  })

  it('returns null when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const result = await service.validateUser('a@b.com', 'pass')
    expect(result).toBeNull()
  })

  it('returns null when password is wrong', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1', email: 'a@b.com', passwordHash: await bcrypt.hash('correct', 10), role: 'user',
    })
    const result = await service.validateUser('a@b.com', 'wrong')
    expect(result).toBeNull()
  })

  it('returns token when credentials are valid', async () => {
    const hash = await bcrypt.hash('password123', 10)
    mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'a@b.com', passwordHash: hash, role: 'user' })
    const result = await service.login('a@b.com', 'password123')
    expect(result).not.toBeNull()
    expect(result!.token).toBe('token')
  })
})
