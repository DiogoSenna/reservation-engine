import {
  Injectable, CanActivate, ExecutionContext,
  HttpException, HttpStatus,
} from '@nestjs/common'
import { RateLimitService } from './rate-limit.service'
import { MetricsService } from '../metrics/metrics.service'
import type { JwtPayload } from '../types'

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest()
    const user = req.user as JwtPayload | undefined
    const key = user ? `ratelimit:${user.sub}` : `ratelimit:ip:${req.ip}`

    const { allowed, retryAfterMs } = await this.rateLimit.check({
      key,
      windowMs: 60_000,
      maxRequests: 10,
    })

    if (!allowed) {
      this.metrics.purchaseFailedTotal.inc({ reason: 'rate_limited' })
      const res = context.switchToHttp().getResponse()
      res.header('Retry-After', Math.ceil(retryAfterMs / 1000).toString())
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS)
    }

    return true
  }
}
