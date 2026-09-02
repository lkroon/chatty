import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as urlGuardModule from './url-guard';
import { fetchPage } from './web-fetch';
import { ToolBudget, FETCH_MAX_BYTES } from './tool-budget';

async function startFakeServer(
  handler: http.RequestListener,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const actualCheckUrl = jest.requireActual('./url-guard').checkUrl as typeof urlGuardModule.checkUrl;

/**
 * The SSRF guard correctly blocks 127.0.0.1, which is exactly what the local
 * fixture server binds to. Every other test file exercises the real guard
 * (see url-guard.spec.ts and the redirect test below); these fixture tests
 * only need the *initial* hop to the fake server allowed, so requests are
 * routed through the real guard for everything except that one origin —
 * a redirect to a genuinely blocked address is still refused for real.
 */
function allowOnly(baseUrl: string): jest.SpyInstance {
  return jest.spyOn(urlGuardModule, 'checkUrl').mockImplementation(async (url: string) => {
    if (url.startsWith(baseUrl)) {
      return { allowed: true };
    }
    return actualCheckUrl(url);
  });
}

describe('fetchPage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('extracts readable text from a real HTML page, with nav and script stripped', async () => {
    const server = await startFakeServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head><title>Example Page</title></head>
          <body>
            <nav>Home | About | Contact</nav>
            <script>trackEverything();</script>
            <main><p>The main content lives here.</p></main>
            <footer>Copyright nobody</footer>
          </body>
        </html>
      `);
    });
    allowOnly(server.baseUrl);

    try {
      const result = await fetchPage(server.baseUrl, new ToolBudget(), new AbortController().signal);
      expect(result.status).toBe('done');
      expect(result.content).toContain('The main content lives here.');
      expect(result.content).not.toContain('Home | About | Contact');
      expect(result.content).not.toContain('trackEverything');
      expect(result.content).not.toContain('Copyright nobody');
      expect(result.content).toContain('Example Page');
      expect(result.label).toBe(`Read 127.0.0.1`);
      expect(result.sources).toEqual([{ title: 'Example Page', url: server.baseUrl }]);
    } finally {
      await server.close();
    }
  });

  it('refuses a redirect chain that ends at a blocked address, without ever connecting to it', async () => {
    const server = await startFakeServer((req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    allowOnly(server.baseUrl);

    try {
      const result = await fetchPage(server.baseUrl, new ToolBudget(), new AbortController().signal);
      expect(result.status).toBe('failed');
      expect(result.content).toMatch(/blocked/i);
    } finally {
      await server.close();
    }
  });

  it('refuses an unsupported content type', async () => {
    const server = await startFakeServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end('%PDF-1.4 ...');
    });
    allowOnly(server.baseUrl);

    try {
      const result = await fetchPage(server.baseUrl, new ToolBudget(), new AbortController().signal);
      expect(result.status).toBe('failed');
      expect(result.content).toMatch(/application\/pdf/);
    } finally {
      await server.close();
    }
  });

  it('aborts a body that exceeds FETCH_MAX_BYTES rather than buffering all of it', async () => {
    const server = await startFakeServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const chunk = 'a'.repeat(65536);
      const chunks = Math.ceil((FETCH_MAX_BYTES + 65536) / chunk.length);
      let written = 0;
      const writeNext = () => {
        if (written >= chunks) {
          res.end();
          return;
        }
        written += 1;
        res.write(chunk, () => writeNext());
      };
      writeNext();
    });
    allowOnly(server.baseUrl);

    try {
      const result = await fetchPage(server.baseUrl, new ToolBudget(), new AbortController().signal);
      expect(result.status).toBe('failed');
      expect(result.content).toMatch(/limit/i);
    } finally {
      await server.close();
    }
  }, 15000);

  it('claims a fetch from the budget and refuses once exhausted', async () => {
    const server = await startFakeServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello');
    });
    allowOnly(server.baseUrl);
    const budget = new ToolBudget();

    try {
      await fetchPage(server.baseUrl, budget, new AbortController().signal);
      await fetchPage(server.baseUrl, budget, new AbortController().signal);
      const third = await fetchPage(server.baseUrl, budget, new AbortController().signal);
      expect(third.status).toBe('failed');
      expect(third.content).toContain('Tool budget exhausted for this message');
    } finally {
      await server.close();
    }
  });
});
