import { randomBytes } from 'node:crypto';
import { decryptToken, encryptToken } from './token-crypto';

describe('token-crypto', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a token', () => {
    const sealed = encryptToken('1//refresh-token-value', key);
    expect(decryptToken(sealed, key)).toBe('1//refresh-token-value');
  });

  it('never emits the plaintext in the sealed string', () => {
    const sealed = encryptToken('1//refresh-token-value', key);
    expect(sealed).not.toContain('refresh-token-value');
  });

  it('produces a different ciphertext each time (random iv)', () => {
    expect(encryptToken('same', key)).not.toBe(encryptToken('same', key));
  });

  it('throws when the ciphertext was tampered with', () => {
    const sealed = encryptToken('secret', key);
    const [iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [iv, tag, flipped.toString('base64')].join('.');
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it('throws when decrypted with the wrong key', () => {
    const sealed = encryptToken('secret', key);
    expect(() => decryptToken(sealed, randomBytes(32).toString('base64'))).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptToken('secret', randomBytes(16).toString('base64'))).toThrow(
      /32 bytes/,
    );
  });
});
