import type { ChatEvent } from '@contracts/chat';

/**
 * Frames one ChatEvent as our own SSE wire format:
 * `event: <type>\ndata: <json>\n\n`. This is entirely independent of
 * whatever framing the OpenCode upstream uses — see opencode/opencode-client.ts,
 * which parses the upstream's SSE stream and re-emits it as ChatEvent
 * values passed to this function, never piping upstream bytes through.
 */
export function formatSseEvent(event: ChatEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
