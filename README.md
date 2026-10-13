# Wework

本地多 Agent 协作桌面应用。创建多个「Agent 员工」，在应用内自建的房间里跟它们单聊或群聊，用 `@` 指派任务；员工是真实具备执行能力的 agent（读写文件、跑命令），不只是对话。

员工后端优先复用你本机已装的 CLI：

- **Codex CLI**（`codex exec --json`）
- **Claude Code**（`claude -p --output-format stream-json`）

两者都不需要你配置密钥：直接用你本机 CLI 已有的登录。

## 运行

```powershell
npm install          # 首次
npm run app          # 构建并启动
```

或者直接双击仓库根目录的 `Wework.cmd`。

> **关于 Electron 运行时**：npm 11 默认会拦截依赖的安装脚本，导致 Electron 的二进制没被解开，
> 表现为启动时报找不到 Electron。`Wework.cmd` 会自动检测并从本地缓存补上这一步；
> 如果你用 `npm run app` 直接启动，遇到该问题时手动执行一次：
> `node node_modules/electron/install.js`

其它命令：

```powershell
npm test                        # 全部单测（默认跳过真机联调）
npm run typecheck               # 全仓类型检查
npm run build                   # 构建桌面应用产物
$env:BUDDY_LIVE_TESTS="1"; npm run test -w @buddy/core   # 真机联调（会真的调用 codex，消耗少量额度）
```

## 上手三步

1. **员工管理** → 新建员工：填名字（例如「小码」）、选框架（下拉里会显示「已就绪/未找到」）、选权限。
   同一个框架可以创建多名员工，彼此完全独立：各自的工作目录、会话、权限、人设。
2. **单聊**：左侧「单聊」区点员工名字即进入与它的私聊，不需要 `@`。
3. **群聊**：点「新建群聊」建房间，新房间默认把当前所有员工拉进来；在房间头部点员工名可加入/移出成员。
4. 在房间里发消息，用 `@` 指派：

   ```
   @小码 把 README 里的错别字改一下
   @all 各自检查一下自己的模块
   ```

   被 @ 的员工会在自己的工作目录里干活，输出实时回流到房间。员工之间也可以互相 `@` 接力。

## 员工记忆

每位员工有自己的长期记忆，**默认开启**，单聊和群聊都会记，并且默认跨房间回忆——所以它更像一个记得住事的同事，而不是每次都从零开始。

- 每次干完活，会把「任务 → 结果」压成一条记忆写进自己的记忆文件。
- 记忆会在下次运行时注入提示词，员工看得到自己以前做过什么。
- 记忆条数到达阈值（默认 20 条）后会自动整理：把最旧的若干条交给员工自己压缩成一条摘要，避免无限膨胀。
- 达到上限（默认 200 条）后从最旧处丢弃。
- 在「员工管理」里能看到每位员工的记忆条数并一键清空；开关、阈值、注入条数都在设置里可调。

记忆文件在数据目录的 `memory\<员工id>.jsonl`，是纯文本，可以直接看和改。

## 技能

技能是**目录**而不是手填字符串：每个技能是一个含 `SKILL.md` 的子目录（`SKILL.md` 头部可写 `name` 与 `description`）。

- 自己的技能放在数据目录的 `skills\<名称>\SKILL.md`，也可以在设置里添加额外的技能根目录。
- 默认**同时扫描框架自带的技能目录**（`~/.codex/skills`、`~/.agents/skills`、`~/.claude/skills`），所以 Codex / Claude Code 里已有的技能可以直接复用，不用再抄一份。
- 在「员工管理」里为每个员工**勾选**要启用的技能；同名技能以 Wework 自己的目录为准。
- 运行时会把已启用技能的 SKILL.md 路径写进提示词，由员工在任务匹配时按需读取（渐进式披露），不占上下文。

## 行为与安全

所有「拿不准」的策略都在**设置**里可改，默认值写在 `packages/core/src/config/schema.ts`：

| 设置 | 默认 | 含义 |
| --- | --- | --- |
| 员工 @ 员工 | 自动执行 | 员工在回复里 @ 同事时立刻接续干活 |
| 员工 @全体 | 需要我确认 | 员工想广播时先问你 |
| 你 @员工 | 自动执行 | 你 @ 谁谁立刻开始 |
| 同时运行上限 | 3 | 最多几个员工并行 |
| 每轮运行上限 | 5 | 你发一条消息最多触发几次运行 |
| @ 接续层数上限 | 3 | 防两个员工互相无限接力 |
| 重复消息去重窗口 | 5s | 同一条消息不会重复投递给同一员工 |
| 单次运行超时 | 10 分钟 | 超时自动终止（含子进程树） |

另外：

- 「停止全部」立刻中止所有排队与运行中的员工。每次运行都用 `AbortSignal` + 杀进程树，不会留下野进程。
- 权限按员工配置，映射到各框架原生机制：Codex 用 `--sandbox read-only|workspace-write|danger-full-access`，Claude 用 `--permission-mode manual|acceptEdits|bypassPermissions`。
- 员工默认在**自己的工作目录**里干活（`%APPDATA%\Wework\data\workspaces\<员工名>`），不会动你的代码仓库，除非你把工作目录指过去。
- 员工**可以同名**（内部用 id 区分，工作目录也会自动错开）。但同一个房间里如果有两位同名员工，`@这个名字` 不会被投递给任何人——房间会写明是哪些人撞了名字，改名或只留一位即可恢复。
- 员工申请招人时，如果申请里写了工作目录，审批卡片会把那个目录一起显示出来，看清楚再点「批准招人」。
- 内置兜底员工的 API Key 存在**系统安全存储**里（Windows 用 DPAPI 加密，落在数据目录的 `secrets.json`），不进 `config.json`、不会被发到界面，界面上只显示「已设置 / 未设置」。系统不支持安全存储时会拒绝保存，而不是退化成明文。
- 消息记录里万一混进坏行（例如断电写歪了）导致房间打不开，界面会给出「隔离坏行并重新加载」：能解析的消息一条不少，坏行原样备份在 `rooms\<roomId>\messages.jsonl.bad-<时间>`，不会静默丢弃。
- 应用不读取、不打包、不代持任何 CLI 凭证。

## 数据位置

```
%APPDATA%\Wework\data\       （可在设置里改到别处，需重启生效）
  config.json          全局配置（永远留在默认位置，避免改坏目录后找不到配置）
  secrets.json         加密后的密钥（与 config.json 同级，同样是默认位置）
  employees.json       员工档案
  rooms.json           房间
  rooms\<roomId>\messages.jsonl   房间消息
  workspaces\<员工名>\            员工工作目录
  skills\<技能名>\SKILL.md        自己的技能
  memory\<员工id>.jsonl           员工记忆
```

从旧名字 Buddy 升上来的版本，首次启动会把 `%APPDATA%\Buddy\data` 整份拷到新目录（老目录保留，确认无误后可自行删除），员工、房间与记忆都不会丢。

想把数据放到别处：设置 → 数据位置，填好点「保存数据目录并重启」。
也可以用环境变量一次性指定（便于做绿色版）：`set BUDDY_DATA_DIR=E:\BuddyData`。

## 结构

```
packages/core/         纯 Node 核心，不依赖 Electron，可无头测试
  domain/              域模型与 id
  storage/             原子文件存储
  config/              全局配置：schema、默认值、合并、持久化
  employee/ room/      员工与房间存储、消息日志、@ 解析
  room/roomService.ts  房间调度器：投递、并发、预算、@链深度、去重、审批、停止
  launcher/            跨来源探测 codex/claude 可执行文件
  process/             流式子进程执行（逐行事件、超时、取消、杀进程树）
  adapters/            统一 AgentAdapter + Codex / Claude Code 实现
apps/desktop/          Electron 壳：主进程 + preload 桥 + React 界面
docs/superpowers/      设计文档与实施计划
```

依赖方向单向向下，`packages/core` 不允许 `import "electron"`，`adapters/`、`launcher/`、`process/` 不允许反向依赖 `room/`、`employee/`——这些由 `packages/core/test/boundaries.test.ts` 自动检查。

## 已知限制

- 内置兜底员工（无 CLI 时用 OpenAI 兼容接口）尚未实现；没有可用 CLI 时应用可运行但无法派活。
- Codex 在 print 模式下不产出 token 级增量，房间里是**逐条**刷新而不是逐字。
- Claude 的工具调用事件形状按 Anthropic content block 约定实现，本机未捕获到实例。
- 员工职责（人设）当前与提示词一起从 stdin 投递，而不是框架原生的 system prompt 通道。
- 没有安装程序。目前是绿色版：`npm run package` 产出 `apps\desktop\release\Wework-win32-x64\Wework.exe`，双击即用；开发时用 `npm run app` / `Wework.cmd` 启动。
