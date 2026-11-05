/**
 * Operator authorization.
 *
 * ONE operator credential, presented as a bearer token, compared in constant
 * time. There are no per-person operator accounts: `OPERATOR_TOKEN` is the
 * whole admin surface, and a route guarded by this exists only when the
 * deployment set that token (otherwise the route is never mounted and 404s).
 *
 * One answer for every failure — missing header, wrong scheme, wrong token —
 * so the guard cannot be used to tell a near guess from a far one.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../http/errors.js';

/** Hashing both sides first gives equal-length buffers, so the comparison is constant-time. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function requireOperator(token: string) {
  const expected = digest(token);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (presented === '' || !timingSafeEqual(digest(presented), expected)) {
      next(new ApiError('UNAUTHENTICATED', 'Operator authorization is required.'));
      return;
    }
    next();
  };
}
