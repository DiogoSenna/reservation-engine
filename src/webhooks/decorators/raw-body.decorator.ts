import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export const RawBody = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Buffer => {
    return ctx.switchToHttp().getRequest().rawBody as Buffer
  },
)
