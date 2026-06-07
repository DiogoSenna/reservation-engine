import { Injectable, ExecutionContext } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Do not throw when no token is present — just set user to null
  handleRequest<T>(_err: unknown, user: T): T {
    return user ?? (null as T)
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context)
  }
}
