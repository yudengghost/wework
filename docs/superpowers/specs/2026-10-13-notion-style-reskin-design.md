# Buddy 渲染层重构：Notion Style 视觉系统

日期：2026-10-13
状态：已批准（用户选定「Notion 成为唯一风格」）

## 目标

把渲染层从「通透石墨（深色，默认）+ 亮色液态玻璃」两套主题，重构为单一的
Notion Style 文档风视觉系统。

约束来源：用户提供的 Notion Style 提示词。该提示词的禁止项优先级最高，
执行要求是「风格一致性优先于创意延展」。

非目标：

- 不改动主进程的领域逻辑、IPC 通道、房间/员工/记忆等业务行为。
- 不改动 `packages/core`。`ui.theme` 字段保留在配置 schema 中（有测试断言其默认值），
  渲染层不再消费它。
- 不重排界面结构、不增删功能入口（唯一例外见「设置」一节）。

## 术语映射

提示词以 Tailwind 类名书写，而本项目是手写 CSS + 语义 token。按下表把
「禁止的类」翻译成本项目里等价的具体写法：

| 提示词 | 本项目中的等价物 |
| --- | --- |
| `rounded-2xl` / `rounded-3xl` / `rounded-full` | `border-radius: 16px / 22px / 99px` |
| `bg-gradient-*` | `linear-gradient()` / `radial-gradient()` 背景 |
| `shadow-2xl` | `--shadow-2: 0 12px 40px ...` |
| `transition-colors duration-150` | `transition: background-color 150ms` |
| `hover:bg-[#efedea]` | 悬停底色 token |
| `group-hover:opacity-100` | `.list-item:hover .handle` 等派生选择器 |

## Token 层（`styles.css` 的 `:root`）

单一主题，`color-scheme: light`，不再有 `[data-theme]` 分支。

| 语义 | 值 |
| --- | --- |
| 页面底 | `#f7f6f3` |
| 表面（卡片/输入框/弹窗/主内容区） | `#ffffff` |
| 分隔边框 | `#e9e9e7` |
| 强边框 | `#d3d1cb` |
| 正文主色 | `#37352f` |
| 正文辅色 | `#5f5e5a` |
| 正文弱化 | `#6f6e69` |
| 悬停底（Block Highlighting） | `#efedea` |
| 按下底（Micro-click） | `#e3e1db` |
| 品牌蓝（焦点环、描边、选中态） | `#2eaadc` |
| 实心蓝（白字压在上面时） | `#19759b` |
| 红 / 绿 / 黄 | `#eb5757` / `#0f7b6c` / `#dfab01` |
| 圆角：控件 / 卡片 / 浮层 | 4px / 6px / 8px |
| 过渡 | 只保留颜色过渡，150ms 线性 |

字号层级按提示词的 Hero/H1/H2/H3 顺序收敛，正文 14px、行高 1.55，
标题统一 `font-weight: 600`。

### 与提示词配色表的偏离（3 处，均为满足其自检清单里的 AA 要求）

提示词的配色表与它自己的「对比度达到 WCAG AA」要求互相冲突，实测数据：

| 提示词原值 | 实测 | 处理 |
| --- | --- | --- |
| 灰阶第 3 档取 `#9b9a97` | 米色底上 4.14:1 | 灰阶改为 `#37352f` / `#5f5e5a` / `#6f6e69`，三档在米色底上分别 11.35 / 6.01 / 4.73 |
| 主按钮 `#2eaadc` 压白字 | 2.66:1 | 实心块改用 `#19759b`（5.17:1）；品牌蓝保留给焦点环、描边与选中态 |
| 浅色底上的小字直接用原色（如 `#2eaadc` 压 `#eff6ff`） | 2.4:1 | 增加 `--*-ink` 一档专供浅底小字，实测 4.9-6.0:1 |

## 动效与交互

删除（对应禁止项）：

- 所有位移/缩放关键帧：`rise`、`pop`、`toast-in`、`sheet`，以及 `pulse` / `dot`
  里的 `scale` / `translateY`。
- `button:active { transform: scale(0.97) }`。
- Logo 与头像的渐变填充。
- 亮色主题的 `radial-gradient` 背景、`backdrop-filter` 玻璃与遮罩压黑。

保留：

- 虚拟列表定位所需的 `transform: translateY()`（滚动定位，不是动画）。
- 浮层出现时的 opacity 淡入（不位移、不缩放）。
- 「工作中」指示点：只动 opacity 的循环动画。

交互反馈：

- 悬停：`#f7f6f3` → `#efedea`；按下：`#e3e1db`。无位移、无缩放、无边框或阴影跳变。
- 按钮透明底 + 悬停/按下底色变化；主按钮为实心 `#2eaadc`。
- 焦点统一 `outline: 2px solid rgba(46,170,220,0.5)`，保留键盘可达性。
- Drag Handle Illusion：侧栏列表项、员工卡片、成员 chip 在悬停时于左侧淡入 `⋮⋮` 手柄。

## 组件层

- 头像：去掉按 id 派生的渐变，改为浅灰底 + `#37352f` 文字。
- `tag` / `count-pill` / `chip` / `live-badge` 的药丸半径降到 4px。
- 卡片：白底 + 1px 边框 + 6px 圆角，不用阴影；阴影只留给浮层。
- 弹窗：白底、6px 圆角、极轻阴影；遮罩改为浅色半透明。
- 输入框/下拉：白底 + 1px 边框 + 4px 圆角 + 2px 蓝色 focus ring。
- 开关：保留控件语义，改为扁平的小尺寸样式，去掉滑块位移之外的装饰。

## 设置

按「Notion 成为唯一风格」，从设置面板移除「外观主题」选择器；
`ui.tsx` 中仅为该选择器存在的 `Segmented` 组件随之删除。

## 测试与验证

渲染层测试依赖的类名必须保持不变：`.messages`、`.message-slot`、
`.message-slot-inner`、`.msg-row`、`.msg-row.stream`、`.mentions`。

验证步骤与结果：

1. `npm run typecheck` 全仓通过。
2. `npm test`：core 230 passed / 7 skipped，desktop 30 passed。
3. `npm run build` 产出 `dist/renderer/styles.css`。
4. 用应用自带的 `WEWORK_SMOKE=1` 截图模式（真实主进程 + 真实 IPC，数据目录指向
   `.scratch/notion-data` 演示数据）核对首页、群聊、员工管理、设置四个界面。
5. 在真实渲染进程里实测拖拽手柄：`totalHandles: 6, visibleHandles: 1`，
   唯一可见的手柄所在祖先链包含 `:hover` 的 `.msg-row`；`viewport` 与
   `bodyScrollW` 同为 1227，确认手柄落在左侧/右侧的 gutter 里、不产生横向溢出。
6. 逐条执行提示词末尾的交付自检清单：无渐变、无 `rounded-2xl` 及以上、
   无重阴影、无位移与缩放动画、无单侧 accent 描边、无嵌套卡片、
   对比度见上表、`prefers-reduced-motion` 已覆盖。

## 已知遗留

- `packages/core` 的 `ui.theme` 配置项保留但不再影响外观，仅用于兼容已有配置文件。
- `App.tsx` 中的 `.notice` 类此前没有任何样式；本次一并补上最简规则。
- 输入框占位符沿用提示词给的 `placeholder-gray-400`（`#9b9a97`，2.81:1）。
  WCAG 不要求占位符达到 4.5:1，且输入框都有可见标签，故保留该 token。
- 折叠区三角箭头保留了 150ms 的 `rotate` 过渡。禁止项只点名 `translate` 与
  `scale`，而展开/收起的方向指示需要这个反馈；如需绝对静止可一行删除。
- 开关从「会平移的滑块」改成 Notion 的勾选方块，因为滑块位移属于被禁止的
  `translate` 动画。
