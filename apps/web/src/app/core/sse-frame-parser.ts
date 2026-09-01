/** One decoded `event: <type>\ndata: <json>\n\n` frame. */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Incremental parser for the `text/event-stream` framing used by
 * `POST /api/chat`: `event: <type>\ndata: <json>\n\n`. Feed it raw text
 * chunks as they arrive from a `ReadableStream` reader (chunk boundaries do
 * not need to line up with frame boundaries); it buffers partial frames and
 * returns only the frames that were completed by the latest chunk.
 *
 * A frame with no `data:` line is dropped (blank keep-alive lines, if the
 * server ever sends them). Multiple `data:` lines in one frame are joined
 * with `\n`, per the SSE spec.
 */
export class SseFrameParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const frame = parseFrame(raw);
      if (frame) {
        frames.push(frame);
      }
    }
    return frames;
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join('\n') };
}
