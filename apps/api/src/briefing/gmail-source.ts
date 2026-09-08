import { Logger } from '@nestjs/common';
import type { BriefingMail } from '@contracts/briefing';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MAX_MESSAGES = 10;
const MAX_SNIPPET_CHARS = 200;
/**
 * How far back "unread" reaches. A one-day window silently drops anything
 * you did not read yesterday; a week is what a person means by their inbox.
 */
const UNREAD_WINDOW_DAYS = 7;

const logger = new Logger('GmailSource');

interface GmailMessage {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name?: string; value?: string }[] };
}

function header(message: GmailMessage, name: string): string | null {
  const found = message.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

export interface RecentMail {
  items: BriefingMail[];
  /** True when the window held more messages than `items` carries. */
  hasMore: boolean;
}

/**
 * Recent unread mail, as metadata plus Google's own snippet.
 *
 * `format=metadata` with an explicit header allowlist is a deliberate
 * security boundary, not an optimization: message bodies are attacker-
 * authored text, and this data is about to be put in front of a model. The
 * snippet is short and still untrusted, so briefing.service.ts frames the
 * whole section as untrusted data before it goes upstream.
 */
export async function fetchRecentMail(
  accessToken: string,
): Promise<RecentMail> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  const listParams = new URLSearchParams({
    q: `is:unread newer_than:${UNREAD_WINDOW_DAYS}d`,
    // One more than the cap, so overflow is detectable without a second call
    // and without trusting Gmail's resultSizeEstimate.
    maxResults: String(MAX_MESSAGES + 1),
  });
  const listResponse = await fetch(`${GMAIL_BASE}?${listParams.toString()}`, {
    headers,
  });
  if (!listResponse.ok) {
    throw new Error(`Gmail request failed (${listResponse.status})`);
  }
  const list = (await listResponse.json()) as { messages?: { id?: string }[] };
  const ids = (list.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  const hasMore = ids.length > MAX_MESSAGES;
  const capped = ids.slice(0, MAX_MESSAGES);

  const settled = await Promise.all(
    capped.map(async (id): Promise<BriefingMail | null> => {
      const getParams = new URLSearchParams({ format: 'metadata' });
      getParams.append('metadataHeaders', 'From');
      getParams.append('metadataHeaders', 'Subject');
      try {
        const response = await fetch(
          `${GMAIL_BASE}/${id}?${getParams.toString()}`,
          { headers },
        );
        if (!response.ok) {
          logger.warn(
            `skipping message ${id}: Gmail returned ${response.status}`,
          );
          return null;
        }
        const message = (await response.json()) as GmailMessage;
        const receivedMs = Number(message.internalDate ?? '0');
        return {
          id: message.id ?? id,
          from: header(message, 'From') ?? '(unknown sender)',
          subject: header(message, 'Subject') ?? '(no subject)',
          snippet: (message.snippet ?? '').slice(0, MAX_SNIPPET_CHARS),
          receivedAt: new Date(
            Number.isFinite(receivedMs) ? receivedMs : 0,
          ).toISOString(),
        };
      } catch (err) {
        logger.warn(`skipping message ${id}: ${(err as Error).name}`);
        return null;
      }
    }),
  );

  return {
    items: settled.filter((m): m is BriefingMail => m !== null),
    hasMore,
  };
}
