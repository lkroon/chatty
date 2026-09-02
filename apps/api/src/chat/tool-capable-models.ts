import { parseModelsCsv } from '@contracts/model';

// Every id here was live-probed against the real OpenCode API and confirmed
// to honor a `tools` array and actually call the function (2026-09-02) —
// glm-5.3 was the plan's original probe target; the rest were checked ad
// hoc afterward. An id NOT in this list streams exactly as it did before
// Wave 1.5 (no `tools` sent, no chips) rather than risk a silent no-op tool
// call against an unverified model.
const DEFAULT_TOOL_CAPABLE_MODELS =
  'glm-5.3,glm-5.3-flash,glm-5,deepseek-v4-flash,qwen3.8-flash,kimi-k2.7-code,mimo-v2.5';

/** Single source of truth for "are tools offered at all right now" — chat.service.ts and models.controller.ts both defer to this. */
export function isWebSearchEnabled(): boolean {
  return process.env.WEB_SEARCH_ENABLED === 'true';
}

function toolCapableModelIds(): string[] {
  return parseModelsCsv(process.env.TOOL_CAPABLE_MODELS ?? DEFAULT_TOOL_CAPABLE_MODELS);
}

/** True when `modelId` may currently receive the `tools` array: web search is on, and this id is allowlisted. */
export function isToolCapableModel(modelId: string): boolean {
  return isWebSearchEnabled() && toolCapableModelIds().includes(modelId);
}
