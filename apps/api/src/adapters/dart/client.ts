import type { z } from 'zod';
import { CacheLayer, TTL_MS, buildCacheKey } from '../../core/cache.js';
import { SourceError, classifyDartStatus } from '../../core/errors.js';
import { SourceClient } from '../../core/http.js';
import type { RequestQueue } from '../../core/queue.js';
import { DartEnvelopeSchema } from './schema.js';

const BASE_URL = 'https://opendart.fss.or.kr/api';

export interface DartClientOptions {
  apiKey: string;
  queue: RequestQueue;
  cache: CacheLayer;
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * DART 전용 클라이언트.
 *
 * DART 는 오류를 HTTP 상태가 아니라 본문 `status` 로 알려준다.
 * HTTP 200 이어도 status 가 '013' 이면 데이터 없음, '020' 이면 일일 한도 초과다.
 * 그래서 파싱 단계에서 status 를 SourceError 로 변환해 공통 큐/캐시 규칙에 태운다.
 */
export class DartClient {
  private readonly apiKey: string;
  private readonly client: SourceClient;

  constructor(options: DartClientOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('DART_API_KEY 가 비어 있습니다. .env 를 확인하세요');
    }
    this.apiKey = options.apiKey;
    this.client = new SourceClient({
      source: 'DART',
      queue: options.queue,
      cache: options.cache,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  /**
   * 응답이 null 이면 "그 조건에 데이터가 없음"이 확정된 것이다.
   * 오류로 못 받은 경우는 던진다.
   */
  async call<S extends z.ZodType>(
    endpoint: string,
    params: Record<string, string | number>,
    schema: S,
    ttlMs: number = TTL_MS.FINANCIALS,
  ): Promise<z.infer<S> | null> {
    const query = new URLSearchParams({
      crtfc_key: this.apiKey,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });

    const result = await this.client.get({
      // 캐시 키에 API 키를 넣지 않는다. 키를 바꿔도 캐시가 살아야 하고,
      // 무엇보다 키가 DB 에 문자열로 남으면 안 된다.
      cacheKey: buildCacheKey('DART', endpoint, params),
      url: `${BASE_URL}/${endpoint}.json?${query.toString()}`,
      ttlMs,
      parse: (bytes) => this.parseEnvelope(bytes, schema, endpoint),
    });

    return result === null ? null : (result.value as z.infer<S>);
  }

  /**
   * 바이너리 응답 (corpCode.xml 은 zip 으로 온다).
   *
   * 오류일 때는 JSON 이 오므로, zip 시그니처가 아니면 JSON 으로 해석해 status 를 본다.
   */
  async callBinary(
    endpoint: string,
    params: Record<string, string | number> = {},
    ttlMs: number = TTL_MS.COMPANY_MASTER,
  ): Promise<Uint8Array | null> {
    const query = new URLSearchParams({
      crtfc_key: this.apiKey,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });

    const result = await this.client.get({
      cacheKey: buildCacheKey('DART', endpoint, params),
      url: `${BASE_URL}/${endpoint}.xml?${query.toString()}`,
      ttlMs,
      parse: (bytes) => {
        // PK\x03\x04 — zip 시그니처
        const isZip =
          bytes.length > 4 &&
          bytes[0] === 0x50 &&
          bytes[1] === 0x4b &&
          bytes[2] === 0x03 &&
          bytes[3] === 0x04;

        if (isZip) return bytes;

        // zip 이 아니면 오류 응답이다. status 를 꺼내 분류한다.
        const text = new TextDecoder().decode(bytes);
        const status = /<status>(\d+)<\/status>/.exec(text)?.[1];
        const message = /<message>(.*?)<\/message>/.exec(text)?.[1] ?? text.slice(0, 200);
        const kind = status === undefined ? 'PARSE' : (classifyDartStatus(status) ?? 'PARSE');

        throw new SourceError('DART', kind, `${endpoint}: [${status ?? '?'}] ${message}`, {
          ...(status === undefined ? {} : { code: status }),
        });
      },
    });

    return result === null ? null : result.value;
  }

  private parseEnvelope<S extends z.ZodType>(
    bytes: Uint8Array,
    schema: S,
    endpoint: string,
  ): z.infer<S> {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch (cause) {
      throw new SourceError('DART', 'PARSE', `${endpoint}: JSON 파싱 실패`, { cause });
    }

    const envelope = DartEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new SourceError('DART', 'PARSE', `${endpoint}: status 필드가 없습니다`);
    }

    const kind = classifyDartStatus(envelope.data.status);
    if (kind !== null) {
      throw new SourceError(
        'DART',
        kind,
        `${endpoint}: [${envelope.data.status}] ${envelope.data.message}`,
        { code: envelope.data.status },
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new SourceError(
        'DART',
        'PARSE',
        `${endpoint}: 응답 스키마 불일치 — ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', ')}`,
      );
    }

    return parsed.data as z.infer<S>;
  }
}
