import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host
      .switchToHttp()
      .getRequest<Request & { requestId?: string }>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      error instanceof ApiError
        ? { code: error.code, message: error.message, details: error.details }
        : {
            code:
              status === 400
                ? 'VALIDATION_ERROR'
                : status === 401
                  ? 'UNAUTHORIZED'
                  : status === 403
                    ? 'FORBIDDEN'
                    : status === 404
                      ? 'NOT_FOUND'
                      : status === 409
                        ? 'CONFLICT'
                        : status >= 500
                          ? 'INTERNAL_ERROR'
                          : 'HTTP_ERROR',
            message:
              error instanceof HttpException
                ? String(error.message)
                : 'Internal server error',
            details:
              error instanceof HttpException &&
              typeof error.getResponse() === 'object'
                ? error.getResponse()
                : undefined,
          };
    response.status(status).json({
      ...payload,
      request_id: request.requestId ?? request.headers['x-request-id'] ?? null,
    });
  }
}
