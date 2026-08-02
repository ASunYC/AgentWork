import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host
      .switchToHttp()
      .getRequest<Request & { requestId?: string }>();
    const requestId =
      request.requestId ?? request.headers['x-request-id'] ?? randomUUID();

    if (error instanceof DomainError) {
      return response.status(error.status).json({
        code: error.code,
        message: error.message,
        details: error.details,
        request_id: requestId,
      });
    }

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
    return response.status(status).json({
      ...payload,
      request_id: requestId,
    });
  }
}
