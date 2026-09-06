import { buildMimeMessage, sendEmail } from './gmail-writer';
import type { EmailPayload } from './proposal-payloads';

const payload: EmailPayload = {
  to: ['a@example.com', 'b@example.com'],
  subject: 'Lunch?',
  body: 'Are you free at one?',
};

describe('buildMimeMessage', () => {
  it('builds a plain-text message with the recipients and subject', () => {
    const mime = buildMimeMessage(payload);
    expect(mime).toContain('To: a@example.com, b@example.com');
    expect(mime).toContain('Subject: Lunch?');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    // No From header: Gmail fills it in from the authenticated account, and
    // setting it ourselves is how you get a 400 or a spoofed sender.
    expect(mime).not.toContain('From:');
  });

  it('base64-encodes the body so any character survives', () => {
    const mime = buildMimeMessage({ ...payload, body: 'Café — 13:00' });
    const encoded = mime.split('\r\n\r\n')[1];
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('Café — 13:00');
  });

  it('RFC 2047-encodes a non-ASCII subject', () => {
    const mime = buildMimeMessage({ ...payload, subject: 'Café' });
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Café', 'utf8').toString('base64')}?=`);
  });
});

describe('sendEmail', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the base64url-encoded message', async () => {
    let seenUrl = '';
    let seenBody: { raw?: string } = {};
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init.body)) as { raw?: string };
      return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await sendEmail('at-1', payload);

    expect(seenUrl).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    // base64url: no +, / or = padding, or Gmail rejects it.
    expect(seenBody.raw).not.toContain('+');
    expect(seenBody.raw).not.toContain('/');
    expect(seenBody.raw).not.toContain('=');
    expect(Buffer.from(seenBody.raw!, 'base64url').toString('utf8')).toContain('Subject: Lunch?');
    expect(result).toEqual({ externalId: 'msg-1', link: null });
  });

  it('throws on a failure without echoing the response body', async () => {
    global.fetch = jest.fn(async () =>
      new Response('{"error":{"message":"secret detail"}}', { status: 403 }),
    ) as unknown as typeof fetch;

    await expect(sendEmail('at-1', payload)).rejects.toThrow('Gmail send failed (403)');
  });
});
