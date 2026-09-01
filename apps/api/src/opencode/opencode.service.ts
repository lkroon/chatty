import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Model } from '@contracts/model';
import { parseModelsCsv } from '@contracts/model';
import { OpencodeClient } from './opencode-client';
import {
  OpencodeChatCompletionParams,
  OpencodeStreamChunk,
} from './opencode-client.types';

/**
 * Wraps OpencodeClient with the two pieces of state the rest of the app
 * needs: env-var configuration, and the boot-time model list cache for
 * GET /api/models.
 */
@Injectable()
export class OpencodeService implements OnModuleInit {
  private readonly logger = new Logger(OpencodeService.name);
  private readonly client: OpencodeClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private cachedModels: Model[] = [];

  constructor() {
    this.baseUrl = process.env.OPENCODE_BASE_URL ?? '';
    this.apiKey = process.env.OPENCODE_API_KEY ?? '';
    this.client = new OpencodeClient(this.baseUrl, this.apiKey);
  }

  async onModuleInit(): Promise<void> {
    this.cachedModels = await this.fetchModels();
  }

  /** Cached at boot, never refreshed (restart-only) — see class doc. */
  getModels(): Model[] {
    return this.cachedModels;
  }

  streamChatCompletion(
    params: OpencodeChatCompletionParams,
  ): AsyncGenerator<OpencodeStreamChunk> {
    return this.client.streamChatCompletion(params);
  }

  private async fetchModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`OpenCode /models responded ${response.status}`);
      }
      const body: unknown = await response.json();
      const models = OpencodeService.parseModelsResponse(body);
      if (models.length === 0) {
        throw new Error('OpenCode /models returned no model ids');
      }
      return models;
    } catch (err) {
      // Boot fetch failure -> fall back to the static OPENCODE_MODELS csv
      // per the plan. UNVERIFIED upstream shape, see opencode-client.ts.
      this.logger.warn(
        `Falling back to OPENCODE_MODELS csv: failed to fetch ${this.baseUrl}/models at boot (${(err as Error)?.message ?? err})`,
      );
      return parseModelsCsv(process.env.OPENCODE_MODELS).map((id) => ({
        id,
        label: id,
        family: id,
      }));
    }
  }

  /**
   * UNVERIFIED shape: assumed OpenAI-compatible `GET /models` response
   * `{ data: [{ id, owned_by? }] }`. `label` defaults to `id` per the
   * plan (no hardcoded id -> label map); `family` isn't specified by the
   * plan, so it falls back the same way, preferring `owned_by` if the
   * upstream happens to send one.
   */
  private static parseModelsResponse(body: unknown): Model[] {
    const data = (body as { data?: unknown[] })?.data;
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((entry) => entry as { id?: unknown; owned_by?: unknown })
      .filter(
        (entry): entry is { id: string; owned_by?: unknown } =>
          typeof entry.id === 'string' && entry.id.length > 0,
      )
      .map((entry) => ({
        id: entry.id,
        label: entry.id,
        family:
          typeof entry.owned_by === 'string' && entry.owned_by.length > 0
            ? entry.owned_by
            : entry.id,
      }));
  }
}
