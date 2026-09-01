import { SseFrameParser } from './sse-frame-parser';

describe('SseFrameParser', () => {
  it('parses a single complete frame', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('event: meta\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ event: 'meta', data: '{"a":1}' }]);
  });

  it('parses multiple frames delivered in one chunk', () => {
    const parser = new SseFrameParser();
    const frames = parser.push(
      'event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\n',
    );
    expect(frames.length).toBe(2);
    expect(frames[0].data).toBe('{"text":"a"}');
    expect(frames[1].data).toBe('{"text":"b"}');
  });

  it('buffers a frame split across chunks and emits it once complete', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: delta\ndata: {"te')).toEqual([]);
    const frames = parser.push('xt":"ab"}\n\n');
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"ab"}' }]);
  });

  it('joins multiple data: lines with newline', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('event: delta\ndata: line1\ndata: line2\n\n');
    expect(frames[0].data).toBe('line1\nline2');
  });

  it('drops a frame with no data: line', () => {
    const parser = new SseFrameParser();
    const frames = parser.push(': keep-alive\n\nevent: done\ndata: {"finishReason":"stop"}\n\n');
    expect(frames.length).toBe(1);
    expect(frames[0].event).toBe('done');
  });

  it('defaults event to "message" when no event: line is present', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('data: {"x":1}\n\n');
    expect(frames[0].event).toBe('message');
  });
});
