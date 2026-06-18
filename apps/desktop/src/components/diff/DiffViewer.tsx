import { useMemo } from "react";

interface DiffViewerProps {
  diff: string;
  filePath?: string;
  maxLines?: number;
  className?: string;
}

type DiffLine = {
  type: "add" | "del" | "ctx" | "meta" | "empty"
  text: string
  oldLineNo?: number
  newLineNo?: number
}

export function parseDiffForViewer(raw: string): DiffLine[] {
  return parseDiff(raw)
}

export function countAdditions(lines: DiffLine[]): number {
  return lines.filter((l) => l.type === "add").length
}

export function countDeletions(lines: DiffLine[]): number {
  return lines.filter((l) => l.type === "del").length
}

export function extractFilePathFromDiff(diff: string): string | undefined {
  return extractFilePath(diff)
}

const MAX_LINES_DEFAULT = 1000

/**
 * Componente próprio de visualização de diff.
 *
 * Substitui o `<pre>` simples por uma visualização linha-a-linha com:
 *  - cores para linhas adicionadas (verde) e removidas (vermelho);
 *  - numeração de linha (Gutter);
 *  - header de arquivo (quando `diff -la/...` ou `+++` está presente);
 *  - scroll horizontal para linhas longas;
 *  - altura limitada e virtualização simples (truncamento em maxLines);
 *  - fallback para `<pre>` quando o diff está vazio.
 */
export function DiffViewer({ diff, filePath, maxLines = MAX_LINES_DEFAULT, className = "" }: DiffViewerProps) {
  const lines = useMemo(() => parseDiff(diff), [diff])

  if (!diff || diff.trim() === "") {
    return (
      <div className={`rounded-md border border-border bg-bg-deep p-3 ${className}`}>
        <div className="text-[11px] text-text-muted">Sem diff disponível.</div>
      </div>
    )
  }

  const truncated = lines.length > maxLines
  const visibleLines = truncated ? lines.slice(0, maxLines) : lines

  const fileHeader = filePath || extractFilePath(diff)

  return (
    <div
      className={`rounded-md border border-border bg-bg-deep overflow-hidden ${className}`}
      data-testid="diff-viewer"
    >
      {fileHeader && (
        <div className="px-3 py-1.5 border-b border-border bg-bg-input/40 text-[10.5px] font-mono text-text-secondary flex items-center justify-between">
          <span className="truncate">{fileHeader}</span>
          <span className="text-text-faint ml-2 flex-shrink-0">
            {visibleLines.filter((l) => l.type === "add").length} +{" "}
            {visibleLines.filter((l) => l.type === "del").length} -
          </span>
        </div>
      )}
      <div className="overflow-auto max-h-96 font-mono text-[11px] leading-[1.55]">
        <table className="w-full border-collapse">
          <tbody>
            {visibleLines.map((l, i) => (
              <tr key={i} className={lineClass(l.type)}>
                <td className="select-none text-right pr-2 pl-2 text-text-faint w-10 border-r border-border/40">
                  {l.oldLineNo ?? ""}
                </td>
                <td className="select-none text-right pr-2 text-text-faint w-10 border-r border-border/40">
                  {l.newLineNo ?? ""}
                </td>
                <td className="select-none pr-2 text-text-faint w-4">{prefix(l.type)}</td>
                <td className="whitespace-pre pr-3 text-text-primary">{l.text || " "}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {truncated && (
          <div className="px-3 py-2 text-[10.5px] text-text-muted border-t border-border/40 bg-bg-input/20">
            Diff truncado em {maxLines} linhas (total: {lines.length}).
          </div>
        )}
      </div>
    </div>
  )
}

function parseDiff(raw: string): DiffLine[] {
  if (!raw) return []
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line) {
      result.push({ type: "empty", text: "" })
      continue
    }
    // Cabeçalho de arquivo: --- a/path, +++ b/path, diff --git, etc.
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff --git") || line.startsWith("index ")) {
      result.push({ type: "meta", text: line })
      continue
    }
    // Hunk header: @@ -a,b +c,d @@
    if (line.startsWith("@@")) {
      const m = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line)
      if (m) {
        oldLine = parseInt(m[1], 10)
        newLine = parseInt(m[2], 10)
        // Para hunk header, ajustamos para a primeira linha ser -1/+1 já que após o @@ a próxima linha é a primeira
        oldLine = Math.max(1, oldLine - 1)
        newLine = Math.max(1, newLine - 1)
      }
      result.push({ type: "meta", text: line })
      continue
    }
    if (line.startsWith("+")) {
      newLine++
      result.push({ type: "add", text: line.slice(1), newLineNo: newLine })
    } else if (line.startsWith("-")) {
      oldLine++
      result.push({ type: "del", text: line.slice(1), oldLineNo: oldLine })
    } else if (line.startsWith(" ")) {
      oldLine++
      newLine++
      result.push({ type: "ctx", text: line.slice(1), oldLineNo: oldLine, newLineNo: newLine })
    } else {
      // Linha sem prefixo (provavelmente cabeçalho malformado)
      result.push({ type: "ctx", text: line })
    }
  }

  return result
}

function extractFilePath(diff: string): string | undefined {
  // Tenta extrair do `+++ b/...`
  const m = /^\+\+\+\s+(?:b\/)?(.+)$/m.exec(diff)
  return m ? m[1].trim() : undefined
}

function lineClass(type: DiffLine["type"]): string {
  switch (type) {
    case "add":
      return "bg-success-soft/30 text-text-primary"
    case "del":
      return "bg-error-soft/30 text-text-primary"
    case "meta":
      return "bg-bg-input/30 text-text-muted"
    default:
      return "hover:bg-bg-hover/20"
  }
}

function prefix(type: DiffLine["type"]): string {
  switch (type) {
    case "add":
      return "+"
    case "del":
      return "-"
    case "meta":
      return "@"
    default:
      return " "
  }
}
