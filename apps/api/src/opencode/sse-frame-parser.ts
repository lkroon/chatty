/**
 * One parsed Server-Sent Events frame: the concatenated value of every
 * `data:` line in the frame (per the SSE spec, multiple `data:` lines
 * inside one frame join with `\n`), plus the `event:` name if present.
 * Frames with no `data:` line at all (e.g. a bare comment or `id:` line)
 * are dropped by the parser below — the OpenCode upstream isn't expected
 * to send them, and there'd be nothing useful to hand back.
 */
export interface SseFrame {
  event?: string;
  data: string;
}

/**
 * Incrementally frames a raw SSE text stream.
 *
 * SSE frames are separated by a blank line (`\n\n`). A single upstream
 * `fetch()` body chunk has NO guaranteed relationship to frame
 * boundaries — a chunk can end mid `data:` line, contain zero complete
 * frames, or contain several. `push()` buffers whatever isn't yet a
 * complete frame and returns only the frames that ARE complete;
 * `flush()` drains anything left over once the upstream connection ends
 * (a well-behaved stream ends on a `\n\n` boundary, so this is normally
 * a no-op, but some servers omit the final blank line).
 */
export class SseFrameParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    // Normalize CRLF -> LF before framing; harmless to re-run on the
    // still-buffered remainder each call.
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, '\n');

    const frames: SseFrame[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n\n')) !== -1) {
      const rawFrame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const frame = SseFrameParser.parseFrame(rawFrame);
      if (frame) {
        frames.push(frame);
      }
    }
    return frames;
  }

  flush(): SseFrame[] {
    const frame = SseFrameParser.parseFrame(this.buffer);
    this.buffer = '';
    return frame ? [frame] : [];
  }

  private static parseFrame(raw: string): SseFrame | null {
    if (raw.trim().length === 0) {
      return null;
    }
    const dataLines: string[] = [];
    let event: string | undefined;
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      } else if (line.startsWith('event:')) {
        event = line.slice(6).replace(/^ /, '').trim();
      }
      // id:/retry: and comment lines (leading ":") intentionally ignored
      // — the OpenCode upstream isn't expected to use them.
    }
    if (dataLines.length === 0) {
      return null;
    }
    return { event, data: dataLines.join('\n') };
  }
}
