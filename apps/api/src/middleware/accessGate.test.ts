import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ACCESS_COOKIE_NAME, createAccessGate } from './accessGate.js';

const PASSWORD = 'grandpa-2026';

function makeApp(password: string): express.Express {
  const app = express();
  app.use(createAccessGate({ password, publicPaths: ['/api/health'] }));
  app.get('/api/health', (_req, res) => void res.json({ ok: true }));
  app.get('/api/series', (_req, res) => void res.json({ secret: 'series' }));
  return app;
}

describe('createAccessGate', () => {
  it('비밀번호를 안 걸면 아무것도 막지 않는다 (로컬 개발)', async () => {
    const res = await request(makeApp('')).get('/api/series');
    expect(res.status).toBe(200);
  });

  it('비밀번호 없이 오면 401 을 준다', async () => {
    const res = await request(makeApp(PASSWORD)).get('/api/series');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('ACCESS_DENIED');
  });

  it('헬스체크는 게이트 밖이다', async () => {
    // 배포 플랫폼이 여기로 살아있는지 확인한다. 막으면 죽은 걸로 본다.
    const res = await request(makeApp(PASSWORD)).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('쿼리로 준 비밀번호가 맞으면 통과시키고 쿠키를 굽는다', async () => {
    const res = await request(makeApp(PASSWORD)).get('/api/series').query({ pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toContain(ACCESS_COOKIE_NAME);
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('헤더로 준 비밀번호도 받는다', async () => {
    const res = await request(makeApp(PASSWORD))
      .get('/api/series')
      .set('X-Access-Password', PASSWORD);
    expect(res.status).toBe(200);
  });

  it('구워진 쿠키만으로 다음 요청이 통과한다', async () => {
    const res = await request(makeApp(PASSWORD))
      .get('/api/series')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${PASSWORD}`);
    expect(res.status).toBe(200);
  });

  it('틀린 비밀번호는 막는다', async () => {
    const res = await request(makeApp(PASSWORD)).get('/api/series').query({ pw: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('길이가 다른 비밀번호에도 던지지 않고 401 을 준다', async () => {
    // timingSafeEqual 은 길이가 다르면 예외를 던진다. 미리 걸러야 500 이 안 난다.
    const res = await request(makeApp(PASSWORD)).get('/api/series').query({ pw: 'x' });
    expect(res.status).toBe(401);
  });

  it('접두사가 맞아도 통과하지 못한다', async () => {
    const res = await request(makeApp(PASSWORD)).get('/api/series').query({ pw: 'grandpa-202' });
    expect(res.status).toBe(401);
  });

  it('한글 비밀번호도 바이트 단위로 정확히 비교한다', async () => {
    const app = makeApp('할아버지');
    expect((await request(app).get('/api/series').query({ pw: '할아버지' })).status).toBe(200);
    expect((await request(app).get('/api/series').query({ pw: '할아버자' })).status).toBe(401);
  });
});
