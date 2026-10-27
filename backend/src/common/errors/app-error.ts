import { ERROR_CODES, type ErrorCode } from './error-codes.js';

export class AppError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.httpStatus = ERROR_CODES[code];
  }
}
