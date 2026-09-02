import { isToolCapableModel, isWebSearchEnabled } from './tool-capable-models';

describe('tool-capable-models', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('isWebSearchEnabled is false unless the env var is exactly "true"', () => {
    delete process.env.WEB_SEARCH_ENABLED;
    expect(isWebSearchEnabled()).toBe(false);
    process.env.WEB_SEARCH_ENABLED = 'yes';
    expect(isWebSearchEnabled()).toBe(false);
    process.env.WEB_SEARCH_ENABLED = 'true';
    expect(isWebSearchEnabled()).toBe(true);
  });

  it('isToolCapableModel is false for everything when web search is off, regardless of TOOL_CAPABLE_MODELS', () => {
    delete process.env.WEB_SEARCH_ENABLED;
    process.env.TOOL_CAPABLE_MODELS = 'glm-5.3';
    expect(isToolCapableModel('glm-5.3')).toBe(false);
  });

  it('defaults TOOL_CAPABLE_MODELS to the live-probed list when unset', () => {
    process.env.WEB_SEARCH_ENABLED = 'true';
    delete process.env.TOOL_CAPABLE_MODELS;
    for (const id of [
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5',
      'deepseek-v4-flash',
      'qwen3.8-flash',
      'kimi-k2.7-code',
      'mimo-v2.5',
    ]) {
      expect(isToolCapableModel(id)).toBe(true);
    }
    expect(isToolCapableModel('some-unverified-model')).toBe(false);
  });

  it('respects an explicit TOOL_CAPABLE_MODELS override', () => {
    process.env.WEB_SEARCH_ENABLED = 'true';
    process.env.TOOL_CAPABLE_MODELS = 'only-this-one';
    expect(isToolCapableModel('only-this-one')).toBe(true);
    expect(isToolCapableModel('glm-5.3')).toBe(false);
  });
});
