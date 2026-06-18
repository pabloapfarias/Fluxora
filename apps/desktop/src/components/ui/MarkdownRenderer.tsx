/**
 * MarkdownRenderer — renderiza texto Markdown com tema escuro do Fluxora.
 *
 * Usa `react-markdown` + `remark-gfm` (tabelas, listas de tarefas, etc.)
 * para transformar Markdown cru em HTML formatado.
 *
 * Seguro por padrão: não renderiza HTML inline (rehype-raw NÃO habilitado).
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// ─── Componentes customizados ─────────────────────────────────────────────

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-[22px] font-bold text-text-primary mt-5 mb-3 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[17px] font-bold text-text-primary mt-5 mb-2.5 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[14px] font-semibold text-text-primary mt-4 mb-2 first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="text-[13px] text-text-secondary leading-relaxed mb-3 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-text-secondary">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="text-[13px] text-text-secondary list-disc pl-5 mb-3 space-y-1">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-[13px] text-text-secondary list-decimal pl-5 mb-3 space-y-1">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-[13px] text-text-secondary leading-relaxed">
      {children}
    </li>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="rounded-lg border border-border bg-bg-deep p-3 my-3 overflow-auto">
          <code className="font-mono text-[11.5px] text-text-secondary break-words whitespace-pre-wrap">
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code className="font-mono text-[12px] bg-bg-deep border border-border rounded px-1.5 py-0.5 text-text-primary">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/40 pl-4 my-3 text-text-secondary italic">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:text-accent-hover underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="border-border my-4" />,
  // Tabelas — GFM
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-[12px] border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg-deep">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left px-3 py-2 font-semibold text-text-primary border-b border-border">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-text-secondary border-b border-border-subtle">
      {children}
    </td>
  ),
  // Checkbox GFM (listas de tarefas)
  input: ({ checked, type }) => {
    if (type !== "checkbox") return null;
    return (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mr-1.5 accent-accent"
      />
    );
  },
};

// ─── Componente principal ─────────────────────────────────────────────────

export interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
