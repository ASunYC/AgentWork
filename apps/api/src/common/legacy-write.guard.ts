import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/** V1 writes are isolated for historical settlement; they are off in the V2 product. */
@Injectable()
export class LegacyWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.path.startsWith('/v1/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      process.env.LEGACY_WRITE_ENABLED !== 'true'
    )
      throw new ForbiddenException(
        'Legacy writes are disabled. Connect an Agent through the V2 API.',
      );
    return true;
  }
}
