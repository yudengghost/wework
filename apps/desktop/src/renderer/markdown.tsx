import { type ReactNode } from "react";

/**
 * 消息正文的 Markdown 渲染。
 *
 * 为什么不装依赖：员工回复里的 Markdown 种类很有限（标题、列表、代码块、表格、
 * 引用、强调、链接），而打包是离线手写的、运行期不带 node_modules；与其引一个
 * 解析器 + 一个 sanitizer，不如按需要实现这几十行——而且这里全程构造 React 元素，
 * 从不把字符串塞进 innerHTML，天然没有注入面。
 *
 * 只认「行首块级语法 + 单层行内语法」，不做嵌套列表、HTML 透传、脚注这类
 * 在聊天里几乎不会出现、却会把解析器复杂度翻几倍的东西。
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; head: string[]; rows: string[][] };

// 行内语法一次扫完：代码 > 链接 > 粗体 > 斜体。
// 强调的定界符后面不能跟空白、前面不能有空白，否则「2 * 3 * 4」会被吃成斜体。
// 链接地址允许一层括号（`wiki/Foo_(bar)` 与 `javascript:alert(1)` 都要能整段认出来，
// 认出来之后再由 safeHref 决定放不放行）。
const INLINE_PATTERN =
  /`([^`\n]+)`|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*|__(?!\s)([^_\n]+?)(?<!\s)__|\*(?!\s)([^*\n]+?)(?<!\s)\*|_(?!\s)([^_\n]+?)(?<!\s)_/g;

/** 只放行能安全打开的协议；其余（例如 javascript:）一律按普通文本显示。 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;
  for (let match = INLINE_PATTERN.exec(text); match !== null; match = INLINE_PATTERN.exec(text)) {
    if (match.index > cursor) nodes.push({ kind: "text", text: text.slice(cursor, match.index) });
    cursor = match.index + match[0].length;

    const [, code, linkText, href, strongStar, strongScore, emStar, emScore] = match;
    if (code !== undefined) nodes.push({ kind: "code", text: code });
    else if (linkText !== undefined && href !== undefined) {
      const safe = safeHref(href);
      nodes.push(
        safe === null
          ? { kind: "text", text: linkText }
          : { kind: "link", text: linkText, href: safe },
      );
    } else if (strongStar !== undefined || strongScore !== undefined) {
      nodes.push({ kind: "strong", text: strongStar ?? strongScore ?? "" });
    } else if (emStar !== undefined || emScore !== undefined) {
      nodes.push({ kind: "em", text: emStar ?? emScore ?? "" });
    }
  }
  if (cursor < text.length) nodes.push({ kind: "text", text: text.slice(cursor) });
  return nodes.length === 0 ? [{ kind: "text", text }] : nodes;
}

const FENCE = /^\s*(```|~~~)\s*([A-Za-z0-9+#._-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableStart(line: string, next: string | undefined): boolean {
  return next !== undefined && line.includes("|") && TABLE_DIVIDER.test(next);
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const next = lines[index + 1];

    const fence = FENCE.exec(line);
    if (fence !== null) {
      flushParagraph();
      const marker = fence[1] as string;
      const language = fence[2] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] as string;
        if (FENCE.test(current) && current.trim().startsWith(marker)) break;
        body.push(current);
        index += 1;
      }
      blocks.push({ kind: "code", language, text: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE.test(line) && !BULLET.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: (heading[1] as string).length,
        text: heading[2] as string,
      });
      continue;
    }

    if (isTableStart(line, next)) {
      flushParagraph();
      const head = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] as string).includes("|")) {
        rows.push(splitRow(lines[index] as string));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = bullet === null;
      const items: string[] = [(bullet?.[1] ?? ordered?.[1]) as string];
      while (index + 1 < lines.length) {
        const candidate = lines[index + 1] as string;
        const nextBullet = BULLET.exec(candidate);
        const nextOrdered = ORDERED.exec(candidate);
        if (isOrdered ? nextOrdered === null : nextBullet === null) break;
        // 有序表里混进无序项时不当成同一张列表，交给下一轮循环另起一块。
        if (isOrdered && nextBullet !== null) break;
        if (!isOrdered && nextOrdered !== null && candidate.trim() !== "") break;
        items.push((isOrdered ? nextOrdered?.[1] : nextBullet?.[1]) as string);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote !== null) {
      flushParagraph();
      const parts: string[] = [quote[1] as string];
      while (index + 1 < lines.length) {
        const nested = QUOTE.exec(lines[index + 1] as string);
        if (nested === null) break;
        parts.push(nested[1] as string);
        index += 1;
      }
      blocks.push({ kind: "quote", text: parts.join("\n") });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function inlineNodes(text: string): ReactNode[] {
  return parseInline(text).map((node, index) => {
    switch (node.kind) {
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{node.text}</strong>;
      case "em":
        return <em key={index}>{node.text}</em>;
      case "link":
        // 走系统浏览器打开：渲染层自己不允许导航（主进程还有一道拦截）。
        return (
          <a key={index} href={node.href} target="_blank" rel="noreferrer">
            {node.text}
          </a>
        );
      case "text":
        return <span key={index}>{node.text}</span>;
    }
  });
}

/** 段落里的换行按 Markdown 的规矩折成空格显示，除非是硬换行。 */
function paragraphNodes(text: string): ReactNode[] {
  return text.split("\n").flatMap((line, index) => [
    ...(index === 0 ? [] : ["\n"]),
    ...inlineNodes(line),
  ]);
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(block.level, 4)}` as "h1" | "h2" | "h3" | "h4";
            return <Tag key={index}>{inlineNodes(block.text)}</Tag>;
          }
          case "paragraph":
            return <p key={index}>{paragraphNodes(block.text)}</p>;
          case "code":
            return (
              <pre key={index} className="md-code">
                {block.language !== "" && <span className="md-lang">{block.language}</span>}
                <code>{block.text}</code>
              </pre>
            );
          case "list":
            return block.ordered ? (
              <ol key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inlineNodes(item)}</li>
                ))}
              </ol>
            ) : (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inlineNodes(item)}</li>
                ))}
              </ul>
            );
          case "quote":
            return <blockquote key={index}>{paragraphNodes(block.text)}</blockquote>;
          case "rule":
            return <hr key={index} />;
          case "table":
            return (
              <table key={index}>
                <thead>
                  <tr>
                    {block.head.map((cell, cellIndex) => (
                      <th key={cellIndex}>{inlineNodes(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{inlineNodes(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
        }
      })}
    </div>
  );
}
