/**
 * Rate Limiting Module (In-Memory Token Bucket)
 *
 * NOTE: This is an in-memory solution suited for single-instance Node.js deployments.
 * For distributed multi-instance / serverless production clusters, replace this with
 * an external centralized store like Redis or Upstash.
 */

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

const VALID_IP_PATTERN = /^[0-9a-fA-F:.]{2,64}$/;

function normalizeValidIp(candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed || !VALID_IP_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Extract client IP from ingress headers with spoof-resistance (REM-05):
 * 1. Prioritizes platform-verified single-IP headers (`cf-connecting-ip`, `x-vercel-forwarded-for`).
 * 2. Supports right-to-left hop counting on `x-forwarded-for` via `TRUSTED_PROXY_HOPS`
 *    so spoofed client-prepended entries cannot bypass rate limiting behind reverse proxies.
 * 3. Validates strict IP character/length bounds to prevent memory key pollution.
 */
export function getClientIp(request: Request): string {
  const cfIp = normalizeValidIp(request.headers.get('cf-connecting-ip'));
  if (cfIp) return cfIp;

  const vercelForwarded = request.headers.get('x-vercel-forwarded-for');
  if (vercelForwarded) {
    const vercelIp = normalizeValidIp(vercelForwarded.split(',')[0]);
    if (vercelIp) return vercelIp;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded && forwarded.trim().length > 0) {
    const rawParts = forwarded.split(',');
    if (rawParts[0].trim().length === 0) {
      // Reject malformed leading-comma headers (e.g. ", 10.0.0.2")
      return normalizeValidIp(request.headers.get('x-real-ip')) || '127.0.0.1';
    }
    const hops = rawParts.map((p) => normalizeValidIp(p)).filter((p): p is string => p !== null);
    if (hops.length > 0) {
      const configuredHops = Number(process.env.TRUSTED_PROXY_HOPS ?? '0');
      if (Number.isInteger(configuredHops) && configuredHops > 0) {
        const idx = Math.max(0, hops.length - configuredHops);
        return hops[idx];
      }
      return hops[0];
    }
    return '127.0.0.1';
  }

  const realIp = normalizeValidIp(request.headers.get('x-real-ip'));
  return realIp || '127.0.0.1';
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
} as const;

/** Reset rate limit store (useful for tests) */
export function _resetRateLimitStore(): void {
  rateLimitStore.clear();
}
