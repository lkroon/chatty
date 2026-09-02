import type { ToolDefinition } from './tool-runtime';

/**
 * The exact JSON schemas sent upstream as the `tools` array. Frozen per
 * the Wave 1.5 plan — the model is told exactly this, word for word.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web and return the top results as title, URL and snippet. Use for anything current, or when asked to look something up. Returns snippets only, not full pages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch one web page and return its readable text, truncated. Only use on URLs the user supplied or that web_search returned. Never guess a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL.' },
        },
        required: ['url'],
      },
    },
  },
];
