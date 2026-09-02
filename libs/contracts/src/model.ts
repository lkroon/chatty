/**
 * A chat model exposed by `GET /api/models`.
 *
 * `label` and `family` are resolved at runtime by the api (workstream A)
 * from the live OpenCode upstream model list, falling back to id-as-label
 * when the upstream doesn't supply one. This package intentionally does
 * NOT ship a hardcoded id -> label/family map.
 */
export interface Model {
  id: string;
  label: string;
  family: string;
  /**
   * Wave 1.5: true when this model may currently receive the `web_search`/
   * `web_fetch` tools (WEB_SEARCH_ENABLED and the id is in
   * TOOL_CAPABLE_MODELS). Absent/false everywhere tools are off — never a
   * per-model capability claim independent of the current server config.
   */
  toolCapable?: boolean;
}

/**
 * Parses the `OPENCODE_MODELS` env var: a comma-separated list of bare
 * model ids, e.g. `"glm-5.3,qwen-3.5"`. Whitespace around ids is trimmed
 * and empty entries (from a blank var, trailing commas, etc.) are dropped.
 *
 * An empty/undefined input yields an empty array, meaning `/api/models`
 * should serve only the cached upstream list.
 */
export function parseModelsCsv(csv: string | undefined | null): string[] {
  if (!csv) {
    return [];
  }
  return csv
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}
