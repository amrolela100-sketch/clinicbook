import {
  scrypt,
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHash,
  type ScryptOptions,
} from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024; // 64MB

function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Hash password using scrypt with 16-byte salt and standard parameters.
 * Output format: scrypt$N$r$p$salt$hash
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    cost: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelization: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString('hex')}`;
}

/** Synchronous version used during seed initialization */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, SCRYPT_KEYLEN, {
    cost: SCRYPT_N,
    blockSize: SCRYPT_R,
    parallelization: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString('hex')}`;
}

export interface PasswordVerificationResult {
  valid: boolean;
  needsUpgrade: boolean;
}

/**
 * Verify a password against a stored hash using constant-time comparison (timingSafeEqual).
 * Supports lazy upgrade from legacy SHA-256 hashes.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<PasswordVerificationResult> {
  if (!storedHash) {
    return { valid: false, needsUpgrade: false };
  }

  // Modern scrypt format: scrypt$N$r$p$salt$hash
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 6) {
      return { valid: false, needsUpgrade: false };
    }

    const [, nStr, rStr, pStr, salt, targetHex] = parts;
    const cost = parseInt(nStr, 10);
    const blockSize = parseInt(rStr, 10);
    const parallelization = parseInt(pStr, 10);

    try {
      const derivedKey = await scryptAsync(password, salt, targetHex.length / 2, {
        cost,
        blockSize,
        parallelization,
        maxmem: SCRYPT_MAXMEM,
      });

      const targetBuffer = Buffer.from(targetHex, 'hex');
      if (derivedKey.length !== targetBuffer.length) {
        return { valid: false, needsUpgrade: false };
      }

      const valid = timingSafeEqual(derivedKey, targetBuffer);
      return { valid, needsUpgrade: false };
    } catch (err) {
      console.warn('Scrypt verification error:', err);
      return { valid: false, needsUpgrade: false };
    }
  }

  // Legacy SHA-256 fallback (for lazy migration)
  try {
    const legacyHex = createHash('sha256').update(password).digest('hex');
    const legacyBuffer = Buffer.from(legacyHex, 'hex');
    const targetBuffer = Buffer.from(storedHash, 'hex');

    if (legacyBuffer.length !== targetBuffer.length) {
      return { valid: false, needsUpgrade: false };
    }

    const valid = timingSafeEqual(legacyBuffer, targetBuffer);
    return { valid, needsUpgrade: valid };
  } catch (err) {
    console.warn('Legacy SHA-256 verification error:', err);
    return { valid: false, needsUpgrade: false };
  }
}
