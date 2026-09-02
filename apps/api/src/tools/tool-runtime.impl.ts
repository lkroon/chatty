import { Logger } from '@nestjs/common';
import { TOOL_DEFINITIONS } from './tool-definitions';
import { ToolBudget } from './tool-budget';
import { ToolDefinition, ToolExecutionResult, ToolRuntime } from './tool-runtime';
import { SearchProvider, formatSearchResults } from './search-provider';
import { fetchPage } from './web-fetch';

const logger = new Logger('ToolRuntime');

/** Guarded JSON.parse — malformed `rawArguments` is a model mistake, not a crash. */
function parseArguments(rawArguments: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function invalidArguments(name: string): ToolExecutionResult {
  return {
    status: 'failed',
    content: `Invalid arguments for ${name}. Answer with what you already have.`,
    label: `Couldn't run ${name}`,
    sources: [],
  };
}

export class ToolRuntimeImpl implements ToolRuntime {
  constructor(private readonly searchProvider: SearchProvider) {}

  definitions(): ToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  async execute(
    call: { name: string; rawArguments: string },
    budget: ToolBudget,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    try {
      const result = await this.dispatch(call, budget, signal);
      if (result.status === 'done') {
        return { ...result, content: budget.claimChars(result.content) };
      }
      return result;
    } catch (err) {
      // execute() never throws — a bug here is logged and converted rather
      // than failing the whole exchange.
      logger.error(`Unexpected error executing tool ${call.name}`, err as Error);
      return {
        status: 'failed',
        content: `Tool ${call.name} failed unexpectedly. Answer with what you already have.`,
        label: `Couldn't run ${call.name}`,
        sources: [],
      };
    }
  }

  private async dispatch(
    call: { name: string; rawArguments: string },
    budget: ToolBudget,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    if (call.name === 'web_search') {
      const args = parseArguments(call.rawArguments);
      const query = typeof args?.query === 'string' ? args.query : null;
      if (!query) {
        return invalidArguments(call.name);
      }
      return this.search(query, signal);
    }
    if (call.name === 'web_fetch') {
      const args = parseArguments(call.rawArguments);
      const url = typeof args?.url === 'string' ? args.url : null;
      if (!url) {
        return invalidArguments(call.name);
      }
      return fetchPage(url, budget, signal);
    }
    return {
      status: 'failed',
      content: `Unknown tool: ${call.name}. Answer with what you already have.`,
      label: `Unknown tool`,
      sources: [],
    };
  }

  private async search(query: string, signal: AbortSignal): Promise<ToolExecutionResult> {
    try {
      const results = await this.searchProvider.search(query, signal);
      return {
        status: 'done',
        content: formatSearchResults(results),
        label: `Searched "${query}"`,
        sources: results.map((r) => ({ title: r.title, url: r.url })),
      };
    } catch (err) {
      return {
        status: 'failed',
        content: `Search failed: ${(err as Error)?.message ?? 'provider unreachable'}. Answer from your own knowledge and say the lookup failed.`,
        label: `Couldn't search "${query}"`,
        sources: [],
      };
    }
  }
}
