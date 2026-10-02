import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';

/** Problem bodies keep the `{ status, title, code, detail }` shape used across the API. */
export function badRequest(code: string, detail: string): BadRequestException {
  return new BadRequestException({ status: 400, title: 'Invalid request', code, detail });
}

export function forbidden(code: string, detail: string): ForbiddenException {
  return new ForbiddenException({ status: 403, title: 'Forbidden', code, detail });
}

export function notFound(code: string, detail: string): NotFoundException {
  return new NotFoundException({ status: 404, title: 'Not Found', code, detail });
}

export function conflict(code: string, detail: string, extra?: object): ConflictException {
  return new ConflictException({ status: 409, title: 'Conflict', code, detail, ...extra });
}

export function gone(code: string, detail: string): GoneException {
  return new GoneException({ status: 410, title: 'Gone', code, detail });
}

export function preconditionFailed(code: string, detail: string): PreconditionFailedException {
  return new PreconditionFailedException({
    status: 412,
    title: 'Precondition Failed',
    code,
    detail,
  });
}

export function preconditionRequired(code: string, detail: string): HttpException {
  return new HttpException({ status: 428, title: 'Precondition Required', code, detail }, 428);
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
