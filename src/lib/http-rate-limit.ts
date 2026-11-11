import 'server-only';
import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import {
  checkRateLimit,
  getClientIp,
  type RateLimitConfig,
  type RateLimitResult,
} from './rate-limit';

async function checkSharedLimit(
  scope: string,
  config: RateLimitConfig,
  identity: string,
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const secret = process.env.RATE_LIMIT_KEY_SECRET?.trim();
  if (!url || !token || !secret || secret.length < 32) {
    throw new Error('Shared rate limiter is not configured');
  }
  const endpoint = new URL(url);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) {
    throw new Error('Shared rate limiter requires HTTPS');
  }
  if (
    !Number.isInteger(config.limit) ||
    config.limit <= 0 ||
    !Number.isFinite(config.windowMs) ||
    config.windowMs <= 0
  ) {
    throw new Error('Invalid rate limit policy');
  }

  const redis = new Redis({
    url,
    token,
    cache: 'no-store',
    retry: false,
    enableAutoPipelining: false,
    signal: () => AbortSignal.timeout(2000),
  });
  const interval: Duration = `${Math.max(1, Math.ceil(config.windowMs / config.limit))} ms`;
  const environment = process.env.VERCEL_ENV === 'preview' ? 'preview' : 'production';
  const limiter = new Ratelimit({
    redis,
    prefix: `clinicbook:rate:${environment}:${scope}:${config.limit}:${config.windowMs}`,
    limiter: Ratelimit.tokenBucket(1, interval, config.limit),
    analytics: false,
    ephemeralCache: false,
    // The SDK's default timeout is fail-open. Disable it; transport aborts
    // become 503s below and must never fall back to a local counter.
    timeout: 0,
  });
  const identifier = createHmac('sha256', secret).update(`${scope}:${identity}`).digest('hex');
  const result = await limiter.limit(identifier);
  if (
    result.reason === 'timeout' ||
    !Number.isFinite(result.reset) ||
    result.limit !== config.limit ||
    !Number.isFinite(result.remaining)
  ) {
    throw new Error('Shared rate limiter returned no authoritative result');
  }
  return {
    allowed: result.success,
    limit: result.limit,
    remaining: result.remaining,
    resetMs: Math.max(0, result.reset - Date.now()),
  };
}

export async function limitHttpRequest(
  request: Request,
  scope: string,
  config: RateLimitConfig,
  identity = getClientIp(request),
): Promise<NextResponse | null> {
  let rate: RateLimitResult;
  try {
    rate =
      process.env.NODE_ENV === 'production'
        ? await checkSharedLimit(scope, config, identity)
        : checkRateLimit(`${identity}:${scope}`, config);
  } catch {
    return NextResponse.json(
      {
        success: false,
        code: 'RATE_LIMIT_UNAVAILABLE',
        error: 'خدمة الحماية غير متاحة. حاول لاحقاً.',
      },
      { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } },
    );
  }
  if (rate.allowed) return null;
  return NextResponse.json(
    { success: false, code: 'RATE_LIMITED', error: 'محاولات كثيرة جداً. يرجى المحاولة لاحقاً.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil(rate.resetMs / 1000))),
        'Cache-Control': 'no-store',
      },
    },
  );
}
