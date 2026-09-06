import type { EmailPayload, WriteResult } from './proposal-payloads';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** RFC 2047 encoded-word, for header values Gmail will not accept raw. */
function encodeHeader(value: string): string {
  return ASCII_PRINTABLE.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * One plain-text RFC 2822 message.
 *
 * Deliberately no `From` header — Gmail sets it from the authenticated
 * account, and a sender we chose ourselves would either be rejected or be a
 * spoof. The body is base64 so a newline, an accent or an em dash cannot
 * corrupt the message.
 */
export function buildMimeMessage(payload: EmailPayload): string {
  return [
    `To: ${payload.to.join(', ')}`,
    `Subject: ${encodeHeader(payload.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(payload.body, 'utf8').toString('base64'),
  ].join('\r\n');
}

/**
 * Sends one message as the authenticated account.
 *
 * Irreversible, and there is no idempotency key — which is why 'email' is not
 * in RETRYABLE_KINDS (see proposal-policy.ts): a failure that happened after
 * delivery must not be retried into a second send.
 */
export async function sendEmail(
  accessToken: string,
  payload: EmailPayload,
): Promise<WriteResult> {
  const raw = Buffer.from(buildMimeMessage(payload), 'utf8').toString('base64url');

  const response = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    throw new Error(`Gmail send failed (${response.status})`);
  }

  const sent = (await response.json()) as { id?: string };
  return { externalId: sent.id ?? null, link: null };
}
