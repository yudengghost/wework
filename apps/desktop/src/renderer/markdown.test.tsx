// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown, parseInline, parseMarkdown } from "./markdown";

describe("Markdown 解析：块级", () => {
  it("标题、段落、空行分块", () => {
    const blocks = parseMarkdown("# 进展\n\n第一段\n第二行\n\n## 风险\n\n- 一个");
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
    ]);
    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "进展" });
    expect(blocks[1]).toEqual({ kind: "paragraph", text: "第一段\n第二行" });
  });

  it("代码块保留原样，带上语言，且不解析块内语法", () => {
    const blocks = parseMarkdown("前一句\n\n```ts\nconst a = 1;\n# 不是标题\n```\n\n后一句");
    expect(blocks[1]).toEqual({
      kind: "code",
      language: "ts",
      text: "const a = 1;\n# 不是标题",
    });
    expect(blocks[2]).toEqual({ kind: "paragraph", text: "后一句" });
  });

  it("没闭合的代码块不会把后面的内容吞进代码里（按到结尾算）", () => {
    const blocks = parseMarkdown("```\n只写了一行");
    expect(blocks).toEqual([{ kind: "code", language: "", text: "只写了一行" }]);
  });

  it("有序与无序列表分开成块", () => {
    const blocks = parseMarkdown("- 甲\n- 乙\n\n1. 丙\n2. 丁");
    expect(blocks).toEqual([
      { kind: "list", ordered: false, items: ["甲", "乙"] },
      { kind: "list", ordered: true, items: ["丙", "丁"] },
    ]);
  });

  it("表格：表头 + 分隔行 + 数据行", () => {
    const blocks = parseMarkdown(
      "| 模块 | 状态 |\n| --- | --- |\n| 接口 | 已完成 |\n| 前端 | 70% |",
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        head: ["模块", "状态"],
        rows: [
          ["接口", "已完成"],
          ["前端", "70%"],
        ],
      },
    ]);
  });

  it("竖线但没分隔行的内容不算表格", () => {
    const blocks = parseMarkdown("a | b 只是写了根竖线");
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("引用与分隔线", () => {
    expect(parseMarkdown("> 一句提醒\n> 第二句")).toEqual([
      { kind: "quote", text: "一句提醒\n第二句" },
    ]);
    expect(parseMarkdown("前\n\n---\n\n后").map((block) => block.kind)).toEqual([
      "paragraph",
      "rule",
      "paragraph",
    ]);
  });

  it("三个减号不当列表项，按分隔线处理；单个减号仍是列表", () => {
    expect(parseMarkdown("---")[0]?.kind).toBe("rule");
    expect(parseMarkdown("- 项目")[0]?.kind).toBe("list");
  });
});

describe("Markdown 解析：行内", () => {
  it("认出代码、粗体、斜体与链接", () => {
    expect(parseInline("用 `npm test` 跑 **全部** *用例*，见 [文档](https://example.com/a)")).toEqual([
      { kind: "text", text: "用 " },
      { kind: "code", text: "npm test" },
      { kind: "text", text: " 跑 " },
      { kind: "strong", text: "全部" },
      { kind: "text", text: " " },
      { kind: "em", text: "用例" },
      { kind: "text", text: "，见 " },
      { kind: "link", text: "文档", href: "https://example.com/a" },
    ]);
  });

  it("乘法算式里的星号不会被吃成斜体", () => {
    expect(parseInline("2 * 3 * 4 = 12")).toEqual([{ kind: "text", text: "2 * 3 * 4 = 12" }]);
  });

  it("危险协议不作为链接，退化成文本", () => {
    expect(parseInline("[点我](javascript:alert(1))")).toEqual([{ kind: "text", text: "点我" }]);
  });

  it("地址里带括号的链接能整段认出来", () => {
    expect(parseInline("[条目](https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual([
      { kind: "link", text: "条目", href: "https://en.wikipedia.org/wiki/Foo_(bar)" },
    ]);
  });

  it("下划线强调也能认，且不跨行", () => {
    expect(parseInline("_重点_")).toEqual([{ kind: "em", text: "重点" }]);
    expect(parseInline("_没闭合\n第二行_")).toEqual([{ kind: "text", text: "_没闭合\n第二行_" }]);
  });
});

describe("Markdown 渲染", () => {
  it("真的渲染出元素，而不是把标记原样显示", () => {
    render(<Markdown text={"## 进展\n\n- **接口**已完成\n- 前端 70%"} />);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("进展");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "接口已完成",
      "前端 70%",
    ]);
    expect(document.querySelector("strong")?.textContent).toBe("接口");
  });

  it("代码块与表格有对应的结构", () => {
    render(<Markdown text={"```sh\nnpm test\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"} />);

    expect(document.querySelector(".md-code code")?.textContent).toBe("npm test");
    expect(document.querySelector(".md-lang")?.textContent).toBe("sh");
    expect(document.querySelectorAll("table td")).toHaveLength(2);
  });

  it("链接新窗口打开，且不带 javascript: 的 href", () => {
    render(<Markdown text={"[官网](https://example.com) 与 [坏链](javascript:alert(1))"} />);

    const link = document.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(document.querySelectorAll("a")).toHaveLength(1);
  });

  it("空正文不炸，也不产出多余节点", () => {
    const { container } = render(<Markdown text="" />);
    expect(container.querySelectorAll(".md > *")).toHaveLength(0);
  });
});
