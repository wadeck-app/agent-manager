import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown.js';
import { parseBlocks, safeHref } from './markdownParse.js';

describe('Markdown safety', () => {
  it('shows raw HTML as text, never as elements', () => {
    const { container } = render(<Markdown text={'<script>alert(1)</script> and <img src=x onerror=alert(2)> <b>bold</b>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('does not load markdown images and says so', () => {
    const { container } = render(<Markdown text={'![a cat](https://example.com/cat.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('image not loaded: a cat');
  });

  it('blocks javascript, data and file links but shows their address', () => {
    const { container } = render(<Markdown text={'[click](javascript:alert(1)) [d](data:text/html,x) [f](file:///etc/passwd)'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click (javascript:alert(1))');
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeHref('java\nscript:alert(1)')).toBeUndefined();
    expect(safeHref('https://example.com/x?a=1')).toBe('https://example.com/x?a=1');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
  });

  it('opens web links in a new tab with noopener', () => {
    render(<Markdown text={'see [the docs](https://example.com/docs) or https://example.org/x.'} />);
    const docs = screen.getByRole('link', { name: 'the docs' });
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: 'https://example.org/x' })).toHaveAttribute('href', 'https://example.org/x');
  });

  it('renders headings, lists, nested lists, code blocks with a copy button and tables', () => {
    const text = ['# Title', '', '- one', '  - nested', '- two', '', '1. first', '2. second', '', '```ts', 'const a = <b>1</b>;', '```', '', '| a | b |', '| - | - |', '| 1 | 2 |'].join('\n');
    const { container } = render(<Markdown text={text} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(container.querySelectorAll('ul')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('pre code')?.textContent).toBe('const a = <b>1</b>;');
    expect(container.querySelector('pre b')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('keeps an unclosed code fence as code', () => {
    expect(parseBlocks('```\nunfinished')).toEqual([{ t: 'code', lang: '', text: 'unfinished' }]);
  });

  it('does not turn snake_case words into emphasis', () => {
    const { container } = render(<Markdown text={'use my_var_name and other_thing'} />);
    expect(container.querySelector('em')).toBeNull();
  });
});
