import * as cheerio from 'cheerio';
import * as http from 'node:http';
import * as https from 'node:https';
import { Readable } from 'node:stream';
import type { ToolSource } from '@contracts/chat';
import type { ToolExecutionResult } from './tool-runtime';
import {
  ToolBudget,
  FETCH_MAX_BYTES,
  FETCH_MAX_CHARS,
  FETCH_TIMEOUT_MS,
} from './tool-budget';
import { Logger } from '@nestjs/common';
import { checkUrl } from './url-guard';
import type { ToolFailureKind } from './tool-failure-kind';

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

const logger = new Logger('WebFetch');

function fetchPinned(
  url: URL,
  addresses: NonNullable<Awaited<ReturnType<typeof checkUrl>>['addresses']>,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = (url.protocol === 'https:' ? https : http).request(
      {
        protocol: url.protocol,
        hostname: address.address,
        family: address.family,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Host: url.host,
          'User-Agent': userAgent(),
          Accept: ACCEPTED_CONTENT_TYPES.join(', '),
        },
        ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
        signal,
      },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) {
            headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
        }
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream, {
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
            headers,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

function failed(
  rawUrl: string,
  message: string,
  failureKind: ToolFailureKind,
): ToolExecutionResult {
  return {
    status: 'failed',
    content: message,
    label: `Couldn't read ${hostnameOf(rawUrl)}`,
    sources: [],
    failureKind,
  };
}

function contentTypeOf(header: string | null): string {
  return (header ?? '').split(';')[0].trim().toLowerCase();
}

/** Reads a response body up to `FETCH_MAX_BYTES`, aborting the read (not just the result) past the cap. */
async function readBodyCapped(
  response: Response,
  signal: AbortSignal,
): Promise<string | null> {
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
function extractReadableText(
  html: string,
  title: string,
  finalUrl: string,
): string {
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
    return failed(
      rawUrl,
      'Tool budget exhausted for this message. Answer with what you already have.',
      'budget_exhausted',
    );
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
        // A refused fetch is a security event, not a routine tool failure:
        // either the model was talked into aiming at the private network, or
        // a public host redirected there. Either way it is the one thing in
        // this file worth finding in the log afterwards — the chip only says
        // "couldn't read", and the model's own account of what happened is
        // not evidence.
        logger.warn(
          `web_fetch blocked${hop > 0 ? ` (redirect hop ${hop})` : ''}: ${currentUrl} — ${guard.reason}`,
        );
        return failed(
          currentUrl,
          `URL blocked: ${guard.reason}`,
          'blocked_url',
        );
      }

      if (!guard.addresses?.length) {
        return failed(
          currentUrl,
          'URL blocked: no validated address',
          'blocked_url',
        );
      }

      let response: Response;
      try {
        const url = new URL(currentUrl);
        response = await fetchPinned(
          url,
          guard.addresses,
          timeoutController.signal,
        );
      } catch (err) {
        return failed(
          currentUrl,
          `Fetch failed: ${(err as Error)?.message ?? 'unknown error'}`,
          'fetch_failed',
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return failed(
            currentUrl,
            `Redirect (${response.status}) with no Location header`,
            'too_many_redirects',
          );
        }
        if (hop === MAX_REDIRECTS) {
          return failed(currentUrl, 'Too many redirects', 'too_many_redirects');
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        return failed(
          currentUrl,
          `Fetch failed: HTTP ${response.status}`,
          'http_error',
        );
      }

      const contentType = contentTypeOf(response.headers.get('content-type'));
      if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
        return failed(
          currentUrl,
          `Unsupported content type: ${contentType || 'unknown'}`,
          'unsupported_content_type',
        );
      }

      const body = await readBodyCapped(response, timeoutController.signal);
      if (body === null) {
        // readBodyCapped returns null for two different reasons, and the
        // log is the one place the difference matters: a page nobody can
        // read is not the same finding as a deadline we set too tight.
        return timeoutController.signal.aborted
          ? failed(currentUrl, 'Fetch timed out or was cancelled', 'timeout')
          : failed(
              currentUrl,
              `Page exceeds the ${FETCH_MAX_BYTES}-byte fetch limit`,
              'response_too_large',
            );
      }

      const isHtml =
        contentType === 'text/html' || contentType === 'application/xhtml+xml';
      const pageTitle = isHtml ? extractTitle(body) : '';
      const text = isHtml
        ? extractReadableText(body, pageTitle, currentUrl)
        : body;

      const sources: ToolSource[] = [
        { title: pageTitle || currentUrl, url: currentUrl },
      ];
      return {
        status: 'done',
        content: truncate(text),
        label: `Read ${hostnameOf(currentUrl)}`,
        sources,
      };
    }
    return failed(rawUrl, 'Too many redirects', 'too_many_redirects');
  } catch (err) {
    if (signal.aborted || timeoutController.signal.aborted) {
      return failed(currentUrl, 'Fetch timed out or was cancelled', 'timeout');
    }
    return failed(
      currentUrl,
      `Fetch failed: ${(err as Error)?.message ?? 'unknown error'}`,
      'fetch_failed',
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}
