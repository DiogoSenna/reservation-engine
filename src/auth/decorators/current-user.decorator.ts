import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { JwtPayload } from '../../types'

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => {
    return ctx.switchToHttp().getRequest().user
  },
)
