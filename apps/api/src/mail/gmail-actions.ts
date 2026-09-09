const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

/**
 * Both actions are label changes through `messages.modify`, and both are
 * idempotent — including the 404.
 *
 * Idempotence is load-bearing here, not politeness: Today renders from a
 * browser cache, so the list on screen can be behind Gmail. Marking read
 * something already read, or archiving something already archived, must be a
 * silent success rather than an error the user has to interpret.
 */
async function modify(
  accessToken: string,
  messageId: string,
  removeLabelIds: string[],
): Promise<void> {
  const response = await fetch(
    `${GMAIL_BASE}/${encodeURIComponent(messageId)}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ removeLabelIds }),
    },
  );

  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Gmail modify failed (${response.status})`);
  }
}

/** Removes UNREAD. The message stays in the inbox. */
export async function markMessageRead(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await modify(accessToken, messageId, ['UNREAD']);
}

/**
 * Removes INBOX — exactly what Gmail's own archive does, and reversible from
 * Gmail. UNREAD goes too: an archived message that stays unread would come
 * back on the next Today refresh, since the section queries `is:unread`.
 */
export async function archiveMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await modify(accessToken, messageId, ['INBOX', 'UNREAD']);
}
