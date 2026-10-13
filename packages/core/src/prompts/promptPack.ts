import type { TextFileStore } from "../storage/fileStore";

/**
 * 所有面向模型的文案集中在这里，默认值写在 `defaultPrompts`。
 *
 * 运行时会从数据目录的 `prompts.json` 读取覆盖值（`loadPromptPack`），文件不存在时
 * 自动把默认值写出去，用户直接改文件即可，不必改代码重新构建。
 *
 * 占位符用 `{name}` 形式，由 `render` 替换；缺键或类型不对时回落到默认值。
 */
export const defaultPrompts = {
  /** 第一次在该房间干活的上下文说明。 */
  contextFirstRun: "你第一次在这个房间干活，下面是最近的对话供你了解背景：",
  /** 之后每次只投递增量。 */
  contextDelta: "下面是这个房间里你上次干活之后的新消息：",
  contextEmpty: "（没有新消息）",

  /** 本次任务的收尾指令。占位符：{employee} */
  taskHeader: "现在轮到你，你是「{employee}」。请直接回复下面这条消息：",

  /** 单聊房间里没有同事可 @。 */
  teamDirect: "这是一个单聊房间，房间里只有你和用户，没有其他同事，请不要 @ 任何人。",
  /** 群聊房间的同事名单说明。占位符：{count} */
  teamGroupHeader: "这是一个群聊房间。除你之外还有 {count} 位同事：{list}",
  teamNoColleagues: "（没有）",
  teamMentionGuide:
    "协作方式：在你的回复里写「@同事名字」，这条消息就会被投递给那位同事，它会真的开始干活并在这里回复你。",
  teamBroadcastGuide: "写「@all」或「@全体」会把消息发给房间里除你之外的所有人。",
  teamBudgetNote:
    "注意：每次 @ 都会真的占用一次运行额度，请只在确实需要交接或征求意见时使用；也不要 @ 自己。",
  teamConfirmNote:
    "本房间设置为「员工之间需要人工确认」：你 @ 同事之后要等用户点允许，对方才会开始，因此不要假设它已经做完了。",

  /** 长期记忆注入时的说明。 */
  memoryHeader: "（你的长期记忆：以前归纳下来的约定与结论，不是本次对话内容）",
  /** 技能注入时的说明。 */
  skillsHeader: "以下技能已启用。任务匹配时，先读取对应的 SKILL.md 再动手：",

  /** 附件注入时的说明。占位符：{count} */
  attachmentsHeader: "本次消息带了 {count} 个附件，都已放进你的工作目录，可以直接读取：",
  attachmentsGuide:
    "路径相对你的工作目录。需要时用工具打开它们；图片也可以直接看。不要修改原始附件以外的无关文件。",

  /** 创建员工申请的协议块标记（写在代码块的语言标记位置）。 */
  employeeRequestMarker: "@@create-employee",
  /** 允许员工申请招人时的说明（只有开启该能力才注入）。 */
  employeeRequestGuide: [
    "如果你判断需要一位新同事，可以提交「招人申请」，由用户审批后才会真正创建：",
    "在回复里放一个围栏代码块，语言标记位置写 @@create-employee，块体是这段 JSON：",
    '{"displayName":"名字","framework":"codex","systemPrompt":"这位同事的职责","permissionMode":"read-only|workspace-write|full"}',
    "只填用得上的字段：可选的字段（如 model）用不上就整项省略，不要留空字符串。",
    "请同时说明为什么要招这个人、以及期望它负责什么；一次最多申请一位。",
    "申请只是提议，用户可能拒绝；不要假设新同事已经存在或已经接手。",
  ].join("\n"),

  /** 员工名册（只有被授权招人的员工才看得到）。占位符：{count} */
  companyRosterHeader: "团队现有 {count} 位在册员工（你看得到全体，但只有本房间成员能被你 @ 到）：",
  /** 名册用途提示。 */
  companyRosterGuide:
    "判断是否招人之前先核对这份名单：如果某个角色已经覆盖了你要招的职责，就不要重复提申请；职责重叠时改为建议调整分工。",
  /** 必须说清楚的能力边界，否则它会去 @ 一个不在房间里的人。 */
  companyRosterMentionLimit:
    "注意：你只能 @ 本房间的成员。需要名册里的其他人参与时，请让用户先把它加入本房间，否则你的 @ 不会送达。",
  /** 员工没填人设时的占位。 */
  companyRosterNoRole: "（未填写职责）",
  /** 渐进式披露：告诉员工完整人设去哪里读。占位符：{path} */
  companyRosterLookup:
    "上面每人的职责只是一行摘要。需要看某位同事的完整职责说明时，读取 {path}（内容是每人的完整人设）。",

  /** 归纳长期记忆用的 system prompt 与指令。 */
  distillSystem: "你是记忆整理器，只做归纳，不执行任何任务。",
  distillInstruction: [
    "下面是你最近的工作往来，以及你已经记住的内容。",
    "请提炼出值得长期记住的新信息：约定、决定、用户偏好、重要事实、未完成事项。",
    "不要记录寒暄、一次性细节，也不要重复已经记住的内容。",
    "每行输出一条，以「- 」开头；如果没有任何值得记住的，只输出「无」。",
  ].join("\n"),
  distillEmptyAnswer: "无",

  /** 长期记忆超上限时的折叠指令。 */
  digestSystem: "你是记忆整理器，只做归纳。",
  digestInstruction:
    "把下面这些长期记忆条目合并成一段不超过 200 字的摘要，保留事实、约定与未完成事项。只输出摘要正文。",
  /** 把已有记忆折叠掉时的兜底文案。占位符：{count} */
  digestFallback: "（更早的 {count} 条记忆已折叠）",

  /** 员工职责随提示词一起投递时的包裹。占位符：{role} */
  roleWrapper: "<employee_role>\n{role}\n</employee_role>",
} as const;

// `-readonly`：同态映射默认会继承默认值对象的 readonly 修饰符，那样就改不了覆盖值了。
export type PromptPack = { -readonly [K in keyof typeof defaultPrompts]: string };

/** 把 `{name}` 占位符替换成实际值；缺失的占位符原样保留，便于定位配置错误。 */
export function render(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export function defaultPromptPack(): PromptPack {
  return { ...defaultPrompts };
}

/**
 * 从文件读取覆盖值。只接受已知键的字符串值：
 * 这样用户在文件里加注释性字段、或写错一个键，都不会让程序崩掉或产生空模板。
 */
export function mergePromptPack(raw: unknown): PromptPack {
  const pack = defaultPromptPack();
  if (typeof raw !== "object" || raw === null) return pack;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key in pack && typeof value === "string" && value.trim() !== "") {
      pack[key as keyof PromptPack] = value;
    }
  }
  return pack;
}

/** 读取 prompts.json；文件不存在时把默认值写出去，方便用户直接编辑。 */
export async function loadPromptPack(
  store: TextFileStore,
  filePath: string,
): Promise<{ pack: PromptPack; created: boolean }> {
  const raw = await store.read(filePath);
  if (raw === null) {
    await store.write(filePath, `${JSON.stringify(defaultPrompts, null, 2)}\n`);
    return { pack: defaultPromptPack(), created: true };
  }
  try {
    return { pack: mergePromptPack(JSON.parse(raw)), created: false };
  } catch {
    // 文件被改坏时用默认值继续跑，而不是让整个应用起不来。
    return { pack: defaultPromptPack(), created: false };
  }
}
