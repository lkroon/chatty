import { BadRequestException } from '@nestjs/common';

export interface ConversationCursor {
  updatedAt: Date;
  id: string;
}

export function encodeConversationCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeConversationCursor(cursor: string): ConversationCursor {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator === -1) throw new BadRequestException('invalid cursor');

  const iso = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const updatedAt = new Date(iso);
  if (id === '' || Number.isNaN(updatedAt.getTime()))
    throw new BadRequestException('invalid cursor');

  // Buffer.from is lenient with invalid base64 — round-trip to catch garbage.
  if (encodeConversationCursor(updatedAt, id) !== cursor)
    throw new BadRequestException('invalid cursor');

  return { updatedAt, id };
}
