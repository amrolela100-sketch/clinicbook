/**
 * Local token buckets and trusted-ingress IP selection.
 *
 * HTTP handlers use http-rate-limit.ts, which requires shared Redis in production.
 */
import { isIP } from 'node:net';

interface TokenBucketRecord {
  tokens: number;
  lastRefillAt: number;
  windowMs: number;
}

const rateLimitStore = new Map<string, TokenBucketRecord>();

// Clean expired records periodically to prevent unbounded memory growth
if (typeof setInterval !== 'undefined') {
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now - record.lastRefillAt >= record.windowMs) {
        rateLimitStore.delete(key);
      }
    }
  }, 60000);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window (bucket capacity) */
  limit: number;
  /** Window duration in milliseconds used to derive refill rate (limit / windowMs) */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();

  if (config.limit <= 0) {
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetMs: Math.max(0, config.windowMs),
    };
  }

  if (config.windowMs <= 0) {
    return {
      allowed: true,
      limit: config.limit,
      remaining: Math.max(0, config.limit - 1),
      resetMs: 0,
    };
  }

  const refillRatePerMs = config.limit / config.windowMs;
  const existing = rateLimitStore.get(key);
  const elapsedMs = existing ? Math.max(0, now - existing.lastRefillAt) : 0;
  const tokens = existing
    ? Math.min(config.limit, existing.tokens + (elapsedMs * config.limit) / config.windowMs)
    : config.limit;

  if (tokens < 1) {
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetMs: Math.ceil((1 - tokens) / refillRatePerMs),
    };
  }

  const remainingTokens = tokens - 1;
  rateLimitStore.set(key, {
    tokens: remainingTokens,
    lastRefillAt: now,
    windowMs: config.windowMs,
  });

  return {
    allowed: true,
    limit: config.limit,
    remaining: Math.floor(remainingTokens),
    resetMs: Math.ceil((config.limit - remainingTokens) / refillRatePerMs),
  };
}

function normalizeValidIp(candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (trimmed.length > 64 || isIP(trimmed) === 0) return null;
  return trimmed.toLowerCase();
}

/**
 * Trust Vercel's overwritten ingress headers only when the server is actually
 * running on Vercel. Header markers such as cf-ray/x-vercel-id prove nothing.
 * A non-Vercel proxy topology requires explicit configuration and an origin
 * that cannot be reached around the proxy. Unknown callers share one bucket.
 */
export function getClientIp(request: Request): string {
  if (process.env.VERCEL === '1') {
    return (
      normalizeValidIp(
        request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for'),
      ) ?? '127.0.0.1'
    );
  }
  const configuredHops = Number(process.env.TRUSTED_PROXY_HOPS ?? '0');
  const forwarded = request.headers.get('x-forwarded-for');
  if (
    Number.isInteger(configuredHops) &&
    configuredHops > 0 &&
    forwarded &&
    forwarded.length <= 4096
  ) {
    const hops = forwarded.split(',').map(normalizeValidIp);
    if (hops.length >= configuredHops && hops.every((hop) => hop !== null)) {
      return hops[hops.length - configuredHops]!;
    }
  }
  return '127.0.0.1';
}

/** Pre-configured rate limits for sensitive endpoints */
export const RATE_LIMIT_CONFIGS = {
  // Credential login / signup / forbidden role attempts: 10 attempts per 15 minutes
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  // Demo-only persona quick switcher (strictly gated behind CLINICBOOK_MODE=demo): 30 per 15 minutes
  demoSwitch: { limit: 30, windowMs: 15 * 60 * 1000 },
  // Agent Chat: 20 messages per minute
  chat: { limit: 20, windowMs: 60 * 1000 },
  // Agent Slot Booking: 5 attempts per 10 minutes
  bookSlot: { limit: 5, windowMs: 10 * 60 * 1000 },
  // Direct Appointments creation: 10 per minute
  appointments: { limit: 10, windowMs: 60 * 1000 },
  // Bound all action traffic before authentication, then the verified actor separately.
  actions: { limit: 120, windowMs: 60 * 1000 },
  actionActor: { limit: 60, windowMs: 60 * 1000 },
} as const;

/** Reset rate limit store (useful for tests) */
export function _resetRateLimitStore(): void {
  rateLimitStore.clear();
}
