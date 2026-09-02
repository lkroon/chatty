import * as cheerio from 'cheerio';
import type { ToolSource } from '@contracts/chat';
import type { ToolExecutionResult } from './tool-runtime';
import { ToolBudget, FETCH_MAX_BYTES, FETCH_MAX_CHARS, FETCH_TIMEOUT_MS } from './tool-budget';
import { checkUrl } from './url-guard';

const MAX_REDIRECTS = 3;

/** No dedicated hostname env var exists — APP_ORIGIN already carries it (`https://<host>`, no trailing slash). */
function userAgent(): string {
  let host = 'chat.example.invalid';
  try {
    if (process.env.APP_ORIGIN) {
      host = new URL(process.env.APP_ORIGIN).host;
    }
  } catch {
    // Malformed APP_ORIGIN — fall back rather than let a User-Agent header build crash a fetch.
  }
  return `chatty/1.0 (+https://${host})`;
}

const ACCEPTED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/json',
];

function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

function failed(rawUrl: string, message: string): ToolExecutionResult {
  return {
    status: 'failed',
    content: message,
    label: `Couldn't read ${hostnameOf(rawUrl)}`,
    sources: [],
  };
}

function contentTypeOf(header: string | null): string {
  return (header ?? '').split(';')[0].trim().toLowerCase();
}

/** Reads a response body up to `FETCH_MAX_BYTES`, aborting the read (not just the result) past the cap. */
async function readBodyCapped(response: Response, signal: AbortSignal): Promise<string | null> {
  if (!response.body) {
    return await response.text();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        return null;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > FETCH_MAX_BYTES) {
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

/** Drops boilerplate, picks the main content region, collapses whitespace. */
function extractReadableText(html: string, title: string, finalUrl: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, header, footer, form, iframe').remove();

  const main = $('article').first().length
    ? $('article').first()
    : $('main').first().length
      ? $('main').first()
      : $('[role=main]').first().length
        ? $('[role=main]').first()
        : $('body');

  const raw = main.text();
  const collapsed = raw
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

  return `${title}\n${finalUrl}\n\n${collapsed}`;
}

function truncate(text: string): string {
  if (text.length <= FETCH_MAX_CHARS) {
    return text;
  }
  const cut = text.slice(0, FETCH_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const boundary = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${boundary}\n\n[truncated]`;
}

/**
 * Fetches one page, extracts its readable text, and truncates it. Claims
 * one fetch from `budget` up front — the caller must not also claim it.
 * Never throws.
 */
export async function fetchPage(
  rawUrl: string,
  budget: ToolBudget,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  if (!budget.claimFetch()) {
    return failed(rawUrl, 'Tool budget exhausted for this message. Answer with what you already have.');
  }

  let currentUrl = rawUrl;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onAbort);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const guard = await checkUrl(currentUrl);
      if (!guard.allowed) {
        return failed(currentUrl, `URL blocked: ${guard.reason}`);
      }

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          redirect: 'manual',
          signal: timeoutController.signal,
          headers: { 'User-Agent': userAgent(), Accept: ACCEPTED_CONTENT_TYPES.join(', ') },
        });
      } catch (err) {
        return failed(currentUrl, `Fetch failed: ${(err as Error)?.message ?? 'unknown error'}`);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return failed(currentUrl, `Redirect (${response.status}) with no Location header`);
        }
        if (hop === MAX_REDIRECTS) {
          return failed(currentUrl, 'Too many redirects');
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        return failed(currentUrl, `Fetch failed: HTTP ${response.status}`);
      }

      const contentType = contentTypeOf(response.headers.get('content-type'));
      if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
        return failed(currentUrl, `Unsupported content type: ${contentType || 'unknown'}`);
      }

      const body = await readBodyCapped(response, timeoutController.signal);
      if (body === null) {
        return failed(currentUrl, `Page exceeds the ${FETCH_MAX_BYTES}-byte fetch limit`);
      }

      const isHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml';
      const pageTitle = isHtml ? extractTitle(body) : '';
      const text = isHtml ? extractReadableText(body, pageTitle, currentUrl) : body;

      const sources: ToolSource[] = [{ title: pageTitle || currentUrl, url: currentUrl }];
      return {
        status: 'done',
        content: truncate(text),
        label: `Read ${hostnameOf(currentUrl)}`,
        sources,
      };
    }
    return failed(rawUrl, 'Too many redirects');
  } catch (err) {
    if (signal.aborted || timeoutController.signal.aborted) {
      return failed(currentUrl, 'Fetch timed out or was cancelled');
    }
    return failed(currentUrl, `Fetch failed: ${(err as Error)?.message ?? 'unknown error'}`);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}
