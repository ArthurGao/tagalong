import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { redactText } from '../logging/redact.js';
import { reportError } from '../observability/sentry.js';
import { AppError } from './app-error.js';
import type { ErrorBodyDto as ErrorBody } from './error-body.dto.js';
import type { ErrorCode } from './error-codes.js';

// Framework HttpExceptions (ValidationPipe, unknown routes, guards) mapped onto the DESIGN §17 catalog.
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      const body: ErrorBody = { code: exception.code, message: exception.message };
      if (exception.details !== undefined) body.details = exception.details;
      return { status: exception.httpStatus, body };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status];
      if (code === 'VALIDATION_FAILED') {
        const response = exception.getResponse();
        const details = typeof response === 'object' ? (response as { message?: unknown }).message : response;
        return { status, body: { code, message: 'Validation failed', details } };
      }
      if (code) return { status, body: { code, message: exception.message } };
      if (status < 500) return { status, body: { code: 'BAD_REQUEST', message: exception.message } };
      return this.internal(exception, status);
    }

    // Express middleware (body-parser) rejects with http-errors objects, not HttpException.
    if (isExposedClientError(exception)) {
      return { status: exception.status, body: { code: 'BAD_REQUEST', message: exception.message } };
    }

    return this.internal(exception, 500);
  }

  private internal(exception: unknown, status: number): { status: number; body: ErrorBody } {
    this.logger.error(redactText(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)));
    reportError(exception); // only what we did not answer on purpose: business codes and 4xx never reach Sentry
    return { status, body: { code: 'INTERNAL', message: 'Internal server error' } };
  }
}

function isExposedClientError(e: unknown): e is { status: number; message: string } {
  if (typeof e !== 'object' || e === null) return false;
  const { status, expose, message } = e as { status?: unknown; expose?: unknown; message?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true && typeof message === 'string';
}
