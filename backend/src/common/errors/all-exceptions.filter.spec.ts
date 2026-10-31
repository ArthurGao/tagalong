import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppError } from './app-error.js';

// Third-party boundary: the error reporter.
vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

function hostFor(res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/x' }) }),
  } as unknown as ArgumentsHost;
}

function run(exception: unknown) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  new AllExceptionsFilter().catch(exception, hostFor(res));
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('maps AppError to its catalog status and { code, message, details }', () => {
    const { status, body } = run(new AppError('SOLD_OUT', 'Sold out', { optionId: 'o1' }));
    expect(status).toBe(409);
    expect(body).toEqual({ code: 'SOLD_OUT', message: 'Sold out', details: { optionId: 'o1' } });
  });

  it('omits details when the AppError has none', () => {
    const { body } = run(new AppError('NOT_FOUND', 'Not found'));
    expect(body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });

  it('maps ValidationPipe errors to VALIDATION_FAILED with the field messages', () => {
    const { status, body } = run(new BadRequestException(['email must be an email']));
    expect(status).toBe(400);
    expect(body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: ['email must be an email'],
    });
  });

  it('maps Nest NotFoundException (unknown route) to NOT_FOUND', () => {
    const { status, body } = run(new NotFoundException('Cannot GET /nope'));
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('keeps the status of other framework 4xx errors under BAD_REQUEST', () => {
    const { status, body } = run(new PayloadTooLargeException());
    expect(status).toBe(413);
    expect(body).toEqual({ code: 'BAD_REQUEST', message: 'Payload Too Large' });
  });

  it('maps exposed http-errors client errors (body-parser) to BAD_REQUEST with their status', () => {
    const err = Object.assign(new Error('request entity too large'), { status: 413, expose: true });
    const { status, body } = run(err);
    expect(status).toBe(413);
    expect(body).toEqual({ code: 'BAD_REQUEST', message: 'request entity too large' });
  });

  it('does not trust a status on errors that are not marked expose', () => {
    const { status, body } = run(Object.assign(new Error('internal detail'), { status: 404 }));
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL');
  });

  it('keeps the status of framework 5xx errors but hides their message', () => {
    const { status, body } = run(new ServiceUnavailableException('redis down at 10.0.0.5'));
    expect(status).toBe(503);
    expect(body).toEqual({ code: 'INTERNAL', message: 'Internal server error' });
  });

  it('hides the message of unknown errors behind INTERNAL', () => {
    const { status, body } = run(new Error('db password is hunter2'));
    expect(status).toBe(500);
    expect(body).toEqual({ code: 'INTERNAL', message: 'Internal server error' });
  });

  it('reports to Sentry only what nobody answered on purpose: unexpected 5xx, never business codes or 4xx', () => {
    const capture = vi.mocked(Sentry.captureException);
    capture.mockClear();
    run(new AppError('SOLD_OUT', 'Sold out'));
    run(new NotFoundException());
    run(new BadRequestException(['name must be a string']));
    expect(capture).not.toHaveBeenCalled();
    const crash = new Error('db down');
    run(crash);
    run(new ServiceUnavailableException());
    expect(capture.mock.calls.map((c) => c[0])).toEqual([crash, expect.any(ServiceUnavailableException)]);
  });
});
