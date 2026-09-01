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
export function renderMarkdownToHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  const clean = DOMPurify.sanitize(rawHtml);
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
