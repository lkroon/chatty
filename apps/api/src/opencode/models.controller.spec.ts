import { ModelsController } from './models.controller';
import type { OpencodeService } from './opencode.service';

function fakeOpencodeService(models: { id: string; label: string; family: string }[]): OpencodeService {
  return { getModels: () => models } as unknown as OpencodeService;
}

describe('ModelsController', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('stamps toolCapable=true only for models in TOOL_CAPABLE_MODELS when WEB_SEARCH_ENABLED=true', () => {
    process.env.WEB_SEARCH_ENABLED = 'true';
    process.env.TOOL_CAPABLE_MODELS = 'glm-5.3,glm-5.3-flash';
    const controller = new ModelsController(
      fakeOpencodeService([
        { id: 'glm-5.3', label: 'glm-5.3', family: 'glm-5.3' },
        { id: 'some-other-model', label: 'some-other-model', family: 'x' },
      ]),
    );

    expect(controller.getModels()).toEqual([
      { id: 'glm-5.3', label: 'glm-5.3', family: 'glm-5.3', toolCapable: true },
      { id: 'some-other-model', label: 'some-other-model', family: 'x', toolCapable: false },
    ]);
  });

  it('stamps toolCapable=false for every model when WEB_SEARCH_ENABLED is unset', () => {
    delete process.env.WEB_SEARCH_ENABLED;
    const controller = new ModelsController(
      fakeOpencodeService([{ id: 'glm-5.3', label: 'glm-5.3', family: 'glm-5.3' }]),
    );

    expect(controller.getModels()).toEqual([
      { id: 'glm-5.3', label: 'glm-5.3', family: 'glm-5.3', toolCapable: false },
    ]);
  });
});
