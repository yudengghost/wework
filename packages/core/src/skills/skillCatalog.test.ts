import { describe, expect, it } from "vitest";

import { catalogSkills, type SkillFileSystem } from "./skillCatalog";

interface StubOptions {
  dirs: Record<string, string[]>;
  files: Record<string, string>;
}

function stubFs(options: StubOptions): SkillFileSystem {
  return {
    listDirs: async (dir) => options.dirs[dir] ?? [],
    readFile: async (path) => options.files[path] ?? null,
    isFile: async (path) => path in options.files,
  };
}

const skillDoc = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n正文\n`;

describe("catalogSkills", () => {
  it("扫描 Wework 自己的技能目录并解析 frontmatter", async () => {
    const skills = await catalogSkills({
      dataDir: "D:/data",
      env: {},
      fs: stubFs({
        dirs: { "D:\\data\\skills": ["imagegen"] },
        files: { "D:\\data\\skills\\imagegen\\SKILL.md": skillDoc("图像生成", "生成位图素材") },
      }),
    });

    expect(skills).toEqual([
      {
        id: "imagegen",
        name: "图像生成",
        description: "生成位图素材",
        source: "buddy",
        entryPath: "D:\\data\\skills\\imagegen\\SKILL.md",
      },
    ]);
  });

  it("复用框架自带的技能目录", async () => {
    const skills = await catalogSkills({
      dataDir: "D:/data",
      env: { USERPROFILE: "C:/Users/me" },
      fs: stubFs({
        dirs: { "D:\\data\\skills": [], "C:\\Users\\me\\.codex\\skills": ["imagegen"] },
        files: {
          "C:\\Users\\me\\.codex\\skills\\imagegen\\SKILL.md": skillDoc("Codex 图像", "来自 codex"),
        },
      }),
    });

    expect(skills[0]).toMatchObject({ id: "imagegen", source: "framework" });
  });

  it("关闭框架技能扫描时不再读取那些目录", async () => {
    const skills = await catalogSkills({
      dataDir: "D:/data",
      includeFrameworkSkills: false,
      env: { USERPROFILE: "C:/Users/me" },
      fs: stubFs({
        dirs: { "C:\\Users\\me\\.codex\\skills": ["imagegen"] },
        files: {
          "C:\\Users\\me\\.codex\\skills\\imagegen\\SKILL.md": skillDoc("Codex 图像", "来自 codex"),
        },
      }),
    });

    expect(skills).toEqual([]);
  });

  it("同名时 Wework 目录优先，不会被框架覆盖", async () => {
    const skills = await catalogSkills({
      dataDir: "D:/data",
      env: { USERPROFILE: "C:/Users/me" },
      fs: stubFs({
        dirs: {
          "D:\\data\\skills": ["dup"],
          "C:\\Users\\me\\.codex\\skills": ["dup"],
        },
        files: {
          "D:\\data\\skills\\dup\\SKILL.md": skillDoc("我的", "本地优先"),
          "C:\\Users\\me\\.codex\\skills\\dup\\SKILL.md": skillDoc("框架的", "应被忽略"),
        },
      }),
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "我的", source: "buddy" });
  });

  it("没有 SKILL.md 的子目录不算技能", async () => {
    const skills = await catalogSkills({
      dataDir: "D:/data",
      env: {},
      fs: stubFs({
        dirs: { "D:\\data\\skills": ["empty"] },
        files: {},
      }),
    });

    expect(skills).toEqual([]);
  });

  it("extraRoots 里的技能也算 Wework 自己的", async () => {
    const skills = await catalogSkills({
      dataDir: "D:/data",
      extraRoots: ["E:/my-skills"],
      env: {},
      fs: stubFs({
        dirs: { "D:\\data\\skills": [], "E:\\my-skills": ["writer"] },
        files: { "E:\\my-skills\\writer\\SKILL.md": skillDoc("写作", "长文写作") },
      }),
    });

    expect(skills[0]).toMatchObject({ id: "writer", source: "buddy" });
  });

  it("结果按 id 排序", async () => {
    const skills = await catalogSkills({
      dataDir: "D:/data",
      env: {},
      fs: stubFs({
        dirs: { "D:\\data\\skills": ["zeta", "alpha"] },
        files: {
          "D:\\data\\skills\\zeta\\SKILL.md": skillDoc("Z", "z"),
          "D:\\data\\skills\\alpha\\SKILL.md": skillDoc("A", "a"),
        },
      }),
    });

    expect(skills.map((skill) => skill.id)).toEqual(["alpha", "zeta"]);
  });
});
