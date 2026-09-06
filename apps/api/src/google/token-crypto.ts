import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32;

/**
 * Sealed form is `<iv>.<authTag>.<ciphertext>`, all base64. Three parts
 * rather than one blob so a truncated or hand-edited value fails loudly at
 * parse time instead of producing a confusing auth-tag mismatch.
 */
function readKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

export function encryptToken(plaintext: string, base64Key: string): string {
  const key = readKey(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptToken(sealed: string, base64Key: string): string {
  const key = readKey(base64Key);
  const parts = sealed.split('.');
  if (parts.length !== 3) {
    throw new Error('malformed sealed token');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Reads the key from the environment. Throws at call time, not import time. */
export function requireEncryptionKey(): string {
  const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is not set');
  }
  return key;
}
