import { renderMarkdownToHtml } from './markdown';

describe('renderMarkdownToHtml', () => {
  it('renders basic markdown to HTML', () => {
    const html = renderMarkdownToHtml('**bold** and _italic_');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('strips script tags and inline event handlers', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>\n\ntext <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
  });

  it('wraps fenced code blocks with a copy-block container and button', () => {
    const html = renderMarkdownToHtml('```js\nconsole.log(1);\n```');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('class="copy-btn"');
    expect(html).toContain('console.log(1);');
  });

  it('leaves plain text without a code block untouched by the copy-button pass', () => {
    const html = renderMarkdownToHtml('just some text');
    expect(html).not.toContain('copy-btn');
  });
});
