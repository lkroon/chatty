import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpencodeService } from './opencode.service';

async function startFakeUpstream(
  handler: http.RequestListener,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('OpencodeService model caching', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('caches the upstream /models list at boot and never refetches', async () => {
    let hits = 0;
    const fake = await startFakeUpstream((req, res) => {
      hits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ data: [{ id: 'glm-5.3' }, { id: 'qwen-3.5' }] }),
      );
    });

    try {
      process.env.OPENCODE_BASE_URL = fake.baseUrl;
      process.env.OPENCODE_API_KEY = 'test-key';
      process.env.OPENCODE_MODELS = '';

      const service = new OpencodeService();
      await service.onModuleInit();

      expect(service.getModels()).toEqual([
        { id: 'glm-5.3', label: 'glm-5.3', family: 'glm-5.3' },
        { id: 'qwen-3.5', label: 'qwen-3.5', family: 'qwen-3.5' },
      ]);
      expect(hits).toBe(1);

      // Calling getModels() again does not hit the upstream a second time.
      service.getModels();
      expect(hits).toBe(1);
    } finally {
      await fake.close();
    }
  });

  it('falls back to OPENCODE_MODELS csv when the boot fetch fails', async () => {
    const fake = await startFakeUpstream((req, res) => {
      res.writeHead(500);
      res.end('boom');
    });

    try {
      process.env.OPENCODE_BASE_URL = fake.baseUrl;
      process.env.OPENCODE_API_KEY = 'test-key';
      process.env.OPENCODE_MODELS = 'glm-5.3,qwen-3.5';

      const service = new OpencodeService();
      await service.onModuleInit();

      expect(service.getModels()).toEqual([
        { id: 'glm-5.3', label: 'glm-5.3', family: 'glm-5.3' },
        { id: 'qwen-3.5', label: 'qwen-3.5', family: 'qwen-3.5' },
      ]);
    } finally {
      await fake.close();
    }
  });

  it('serves an empty list when the boot fetch fails and OPENCODE_MODELS is empty', async () => {
    const fake = await startFakeUpstream((req, res) => {
      res.writeHead(500);
      res.end('boom');
    });

    try {
      process.env.OPENCODE_BASE_URL = fake.baseUrl;
      process.env.OPENCODE_API_KEY = 'test-key';
      process.env.OPENCODE_MODELS = '';

      const service = new OpencodeService();
      await service.onModuleInit();

      expect(service.getModels()).toEqual([]);
    } finally {
      await fake.close();
    }
  });
});
