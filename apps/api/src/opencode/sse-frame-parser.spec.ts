import { SseFrameParser } from './sse-frame-parser';

describe('SseFrameParser', () => {
  it('buffers a chunk split mid `data:` line and yields the frame only once complete', () => {
    const parser = new SseFrameParser();

    // First chunk ends partway through the JSON payload on the data: line.
    const first = parser.push(
      'data: {"choices":[{"delta":{"content":"Hel',
    );
    expect(first).toEqual([]);

    // Second chunk completes the line and the frame's trailing blank line.
    const second = parser.push('lo"}}]}\n\n');
    expect(second).toEqual([
      { event: undefined, data: '{"choices":[{"delta":{"content":"Hello"}}]}' },
    ]);
  });

  it('yields a frame immediately when a chunk ends exactly on the \\n\\n boundary', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('data: {"a":1}\n\n');
    expect(frames).toEqual([{ event: undefined, data: '{"a":1}' }]);
  });

  it('yields multiple frames carried in a single chunk', () => {
    const parser = new SseFrameParser();
    const frames = parser.push(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":3}\n\n',
    );
    expect(frames).toEqual([
      { event: undefined, data: '{"a":1}' },
      { event: undefined, data: '{"b":2}' },
      { event: undefined, data: '{"c":3}' },
    ]);
  });

  it('carries the event: field alongside data:', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('event: ping\ndata: {"ok":true}\n\n');
    expect(frames).toEqual([{ event: 'ping', data: '{"ok":true}' }]);
  });

  it('joins multiple data: lines within one frame with \\n per the SSE spec', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('data: line1\ndata: line2\n\n');
    expect(frames).toEqual([{ event: undefined, data: 'line1\nline2' }]);
  });

  it('leaves an incomplete trailing frame buffered across calls with no boundary yet', () => {
    const parser = new SseFrameParser();
    expect(parser.push('data: {"a":1}\n\ndata: {"b":2}')).toEqual([
      { event: undefined, data: '{"a":1}' },
    ]);
    expect(parser.push('\n\n')).toEqual([{ event: undefined, data: '{"b":2}' }]);
  });

  it('flush() drains a final frame that never received a trailing blank line', () => {
    const parser = new SseFrameParser();
    expect(parser.push('data: {"a":1}\n\ndata: {"b":2}')).toEqual([
      { event: undefined, data: '{"a":1}' },
    ]);
    expect(parser.flush()).toEqual([{ event: undefined, data: '{"b":2}' }]);
    // Buffer is cleared after flush.
    expect(parser.flush()).toEqual([]);
  });

  it('ignores empty/whitespace-only frames (e.g. SSE keep-alive blank lines)', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('\n\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ event: undefined, data: '{"a":1}' }]);
  });
});
