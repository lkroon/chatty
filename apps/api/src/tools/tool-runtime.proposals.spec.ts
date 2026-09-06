import type { ProposalCard } from '@contracts/proposal';
import { ToolBudget } from './tool-budget';
import { ToolRuntimeImpl } from './tool-runtime.impl';
import type { ProposalToolOutcome, ProposalToolPort } from './proposal-tool-port';
import type { SearchProvider } from './search-provider';

const ACTOR = { accountId: 7, conversationId: 'c1' };

const card: ProposalCard = {
  id: 'p1',
  kind: 'calendar_event',
  status: 'pending',
  title: 'Dentist',
  fields: [{ label: 'When', value: 'Tue 8 Sep 2026, 15:00 – 15:30' }],
  link: null,
  error: null,
  confirmable: true,
  expiresAt: '2026-09-08T09:59:00.000Z',
  conversationId: 'c1',
};

const noSearch: SearchProvider = { search: async () => [] };

class FakePort implements ProposalToolPort {
  calls: unknown[] = [];
  outcome: ProposalToolOutcome = { ok: true, card };
  async createFromToolCall(input: unknown): Promise<ProposalToolOutcome> {
    this.calls.push(input);
    return this.outcome;
  }
}

function run(runtime: ToolRuntimeImpl, name: string, args: object) {
  return runtime.execute(
    { name, rawArguments: JSON.stringify(args) },
    new ToolBudget(),
    new AbortController().signal,
    ACTOR,
  );
}

describe('ToolRuntimeImpl write tools', () => {
  let port: FakePort;

  beforeEach(() => {
    port = new FakePort();
    process.env.GOOGLE_WRITE_TOOLS_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.GOOGLE_WRITE_TOOLS_ENABLED;
  });

  it('offers the write tools only when enabled and a port is wired', () => {
    const names = () => new ToolRuntimeImpl(noSearch, port).definitions().map((d) => d.function.name);
    expect(names()).toEqual([
      'web_search',
      'web_fetch',
      'create_calendar_event',
      'create_task',
      'send_email',
    ]);

    delete process.env.GOOGLE_WRITE_TOOLS_ENABLED;
    expect(names()).toEqual(['web_search', 'web_fetch']);

    process.env.GOOGLE_WRITE_TOOLS_ENABLED = 'true';
    expect(new ToolRuntimeImpl(noSearch).definitions().map((d) => d.function.name)).toEqual([
      'web_search',
      'web_fetch',
    ]);
  });

  it('passes the call to the port with the actor, and returns the card on the result', async () => {
    const runtime = new ToolRuntimeImpl(noSearch, port);
    const result = await run(runtime, 'create_calendar_event', {
      title: 'Dentist',
      start: '2026-09-08T15:00:00',
    });

    expect(port.calls).toEqual([
      {
        accountId: 7,
        conversationId: 'c1',
        toolName: 'create_calendar_event',
        rawArguments: JSON.stringify({ title: 'Dentist', start: '2026-09-08T15:00:00' }),
      },
    ]);
    expect(result.status).toBe('done');
    expect(result.proposal).toEqual(card);
    expect(result.label).toBe('Proposed: Dentist');
  });

  it('tells the model the action has NOT happened yet', async () => {
    const runtime = new ToolRuntimeImpl(noSearch, port);
    const result = await run(runtime, 'create_calendar_event', {
      title: 'Dentist',
      start: '2026-09-08T15:00:00',
    });

    expect(result.content).toContain('NOT');
    expect(result.content).toContain('Confirm');
    expect(result.content).toContain('Dentist');
    // The wording the model must not be able to justify.
    expect(result.content).not.toContain('has been created');
  });

  it('never wraps a proposal result in the untrusted-web-content frame', async () => {
    const runtime = new ToolRuntimeImpl(noSearch, port);
    const result = await run(runtime, 'create_task', { title: 'Buy milk' });
    expect(result.content).not.toContain('<untrusted-web-content>');
  });

  it('returns a correctable failure when the port rejects the arguments', async () => {
    port.outcome = { ok: false, message: 'create_task: "title" is required (1-200 characters).' };
    const runtime = new ToolRuntimeImpl(noSearch, port);
    const result = await run(runtime, 'create_task', {});

    expect(result.status).toBe('failed');
    expect(result.content).toContain('"title" is required');
    expect(result.label).toBe("Couldn't propose that task");
    expect(result.proposal).toBeUndefined();
  });

  it('fails cleanly when the tool is called with no port wired', async () => {
    const runtime = new ToolRuntimeImpl(noSearch);
    const result = await run(runtime, 'send_email', { to: 'a@x.com', subject: 'S', body: 'B' });
    expect(result.status).toBe('failed');
    expect(result.content).toContain('not available');
  });

  it('converts a port that throws into a failed result, not a thrown error', async () => {
    port.createFromToolCall = async () => {
      throw new Error('database is down');
    };
    const runtime = new ToolRuntimeImpl(noSearch, port);
    const result = await run(runtime, 'create_task', { title: 'X' });
    expect(result.status).toBe('failed');
    expect(result.content).toContain('create_task');
  });
});
