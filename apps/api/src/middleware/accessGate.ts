import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * 가족 전용 접근 제한.
 *
 * URL 이 알려지면 누구나 들어와 DART 일일 호출 한도를 태울 수 있다.
 * 데이터 자체는 공개 소스라 비밀이 아니지만, 한도는 공유 자원이다.
 *
 * 한 번 통과하면 쿠키로 기억한다. 할아버지는 북마크로 들어오시니
 * 처음 한 번만 번거로우면 된다.
 *
 * ACCESS_PASSWORD 가 비어 있으면 게이트를 아예 걸지 않는다 (로컬 개발).
 */

const COOKIE_NAME = 'fincompare_access';
/** 1년. 가족용이라 자주 다시 묻지 않는다 */
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

/**
 * 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다.
 * 길이 자체는 어차피 응답 시간으로 새지 않는다.
 */
function matches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export interface AccessGateOptions {
  password: string;
  /** 게이트를 통과하지 않아도 되는 경로 (헬스체크 등) */
  publicPaths?: readonly string[];
}

export function createAccessGate(options: AccessGateOptions): RequestHandler {
  const { password } = options;
  const publicPaths = new Set(options.publicPaths ?? []);

  return (req, res, next) => {
    // 비밀번호를 안 걸었으면 통과 (로컬 개발)
    if (password === '') {
      next();
      return;
    }

    if (publicPaths.has(req.path)) {
      next();
      return;
    }

    // 이미 통과한 브라우저
    const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
    if (cookie !== null && matches(cookie, password)) {
      next();
      return;
    }

    // 이번 요청에 비밀번호가 실려 왔으면 쿠키를 굽고 통과시킨다
    const supplied =
      typeof req.query['pw'] === 'string'
        ? req.query['pw']
        : typeof req.headers['x-access-password'] === 'string'
          ? req.headers['x-access-password']
          : null;

    if (supplied !== null && matches(supplied, password)) {
      res.cookie?.(COOKIE_NAME, password, {
        maxAge: COOKIE_MAX_AGE_SEC * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
      });
      next();
      return;
    }

    res.status(401).json({
      error: 'ACCESS_DENIED',
      message: '이 페이지는 가족 전용입니다. 비밀번호가 필요합니다.',
    });
  };
}

export const ACCESS_COOKIE_NAME = COOKIE_NAME;
