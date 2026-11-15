import { Fragment, useMemo, type ReactNode } from 'react';
import { CopyButton } from './CopyButton.js';
import { parseBlocks, type Block, type Inline } from './markdownParse.js';
import { LOG_MONO } from './sizes.js';

const HEADING: Record<number, string> = {
  1: 'text-base font-semibold',
  2: 'text-base font-semibold',
  3: 'text-sm font-semibold',
  4: 'text-sm font-semibold',
  5: 'text-sm font-medium',
  6: 'text-sm font-medium text-muted',
};

function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.t) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'code':
        return (
          <code key={index} className="rounded bg-muted-bg px-1 py-0.5 font-mono text-[0.9em]">
            {node.text}
          </code>
        );
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'link':
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline">
            {renderInline(node.children)}
          </a>
        );
      case 'image':
        // Images are never loaded (a remote image is a tracking and privacy leak): the alt text stands in.
        return (
          <span key={index} className="text-muted">
            [image not loaded{node.alt === '' ? '' : `: ${node.alt}`}]
          </span>
        );
    }
  });
}

function renderBlocks(blocks: readonly Block[]): ReactNode {
  return blocks.map((block, index) => {
    switch (block.t) {
      case 'p':
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {renderInline(block.inline)}
          </p>
        );
      case 'h':
        return (
          <p key={index} role="heading" aria-level={block.level} className={`${HEADING[block.level]} break-words`}>
            {renderInline(block.inline)}
          </p>
        );
      case 'code':
        return (
          <div key={index} className="overflow-hidden rounded border border-border bg-muted-bg">
            <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-0.5">
              <span className="truncate text-xs text-muted">{block.lang === '' ? 'text' : block.lang}</span>
              <CopyButton text={block.text} label="Copy code" />
            </div>
            <pre className={`overflow-x-auto p-2 ${LOG_MONO}`}>
              <code>{block.text}</code>
            </pre>
          </div>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag key={index} className={`${block.ordered ? 'list-decimal' : 'list-disc'} flex flex-col gap-0.5 pl-5`}>
            {block.items.map((item, at) => (
              <li key={at} className="break-words">
                <span className="whitespace-pre-wrap">{renderInline(item.inline)}</span>
                {item.children.length > 0 ? <div className="mt-0.5 flex flex-col gap-0.5">{renderBlocks(item.children)}</div> : null}
              </li>
            ))}
          </Tag>
        );
      }
      case 'quote':
        return (
          <blockquote key={index} className="flex flex-col gap-1 border-l-2 border-border pl-3 text-muted">
            {renderBlocks(block.blocks)}
          </blockquote>
        );
      case 'hr':
        return <hr key={index} className="border-border" />;
      case 'table':
        return (
          <div key={index} className="overflow-x-auto">
            <table className="border-collapse text-left text-xs">
              <thead>
                <tr>
                  {block.head.map((cell, at) => (
                    <th key={at} className="border border-border bg-muted-bg px-2 py-1 font-medium">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, at) => (
                  <tr key={at}>
                    {row.map((cell, cellAt) => (
                      <td key={cellAt} className="border border-border px-2 py-1">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** Assistant text as React elements. Safe by construction: see markdownParse.ts (no raw HTML, no images, only http, https and mailto links). */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <div className="flex flex-col gap-2 text-sm leading-am-log">{renderBlocks(blocks)}</div>;
}
