import type {
  BuddyConfig,
  DeepPartial,
  Employee,
  Framework,
  PermissionMode,
} from "@buddy/core";
import { useEffect, useState } from "react";

import { api, type Bootstrap, type CreateEmployeePayload, type MemorySnapshot } from "./api";
import { Avatar, DragHandle, Switch } from "./ui";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ width: 420 }} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p className="sub">{body}</p>
        <div className="row">
          <button className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 把一段没有在册员工的会话接续到一名新建员工上。
 * 用于旧版本硬删除留下的孤儿会话——那些员工的档案已经不存在，无法「恢复」。
 */
export function AdoptDialog({
  roomName,
  onCancel,
  onSubmit,
}: {
  roomName: string;
  onCancel: () => void;
  onSubmit: (name: string, framework: Framework, mode: PermissionMode) => void;
}) {
  const [name, setName] = useState("新员工");
  const [framework, setFramework] = useState<Framework>("codex");
  const [mode, setMode] = useState<PermissionMode>("workspace-write");

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ width: 460 }} onClick={(event) => event.stopPropagation()}>
        <h2>接续「{roomName}」这段历史</h2>
        <p className="sub">
          会新建一名员工并把它设为这个会话的成员，之前的聊天记录全部保留。
        </p>
        <div className="field">
          <label>员工名</label>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label>框架</label>
          <select
            value={framework}
            onChange={(event) => setFramework(event.target.value as Framework)}
          >
            {frameworks.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>权限</label>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as PermissionMode)}
          >
            {permissionModes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            className="primary"
            disabled={name.trim() === ""}
            onClick={() => onSubmit(name.trim(), framework, mode)}
          >
            创建并接续
          </button>
          <button onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

interface CreateRoomDialogProps {
  employees: Bootstrap["employees"];
  onCancel: () => void;
  onSubmit: (name: string, memberIds: string[]) => void;
}

/**
 * 新建群聊：成员由用户自己挑，不再默认拉所有人。
 * （Electron 不支持 window.prompt，所以一切都用应用内弹窗。）
 */
export function CreateRoomDialog({ employees, onCancel, onSubmit }: CreateRoomDialogProps) {
  const [name, setName] = useState("新房间");
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (employeeId: string): void => {
    setSelected((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId],
    );
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ width: 480 }} onClick={(event) => event.stopPropagation()}>
        <h2>新建群聊</h2>
        <p className="sub">选择要拉进来的员工。建好后在房间头部仍可随时增减成员。</p>
        <div className="field">
          <label>房间名称</label>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="field">
          <label>
            成员（已选 {selected.length} / {employees.length}）
          </label>
          {employees.length === 0 ? (
            <div className="sub">还没有员工，先去「员工管理」创建一名。</div>
          ) : (
            <>
              <div className="skill-inline" style={{ marginTop: 0, marginBottom: 8 }}>
                <button onClick={() => setSelected(employees.map((item) => item.id))}>
                  全选
                </button>
                <button onClick={() => setSelected([])}>清空</button>
              </div>
              <div className="skill-list">
                {employees.map((employee) => (
                  <label key={employee.id} className="skill">
                    <input
                      type="checkbox"
                      checked={selected.includes(employee.id)}
                      onChange={() => toggle(employee.id)}
                    />
                    <Avatar name={employee.displayName} seed={employee.id} small />
                    <span>
                      <strong>{employee.displayName}</strong>
                      {employee.framework !== "codex" && (
                        <span className="tag" style={{ marginLeft: 6 }}>
                          {employee.framework}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="row">
          <button
            className="primary"
            disabled={selected.length === 0 || name.trim() === ""}
            onClick={() => onSubmit(name.trim(), selected)}
          >
            创建
          </button>
          <button onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

const frameworks: { value: Framework; label: string }[] = [
  { value: "codex", label: "Codex CLI" },
  { value: "claude-code", label: "Claude Code" },
  { value: "builtin", label: "内置兜底（未实现）" },
];

const permissionModes: { value: PermissionMode; label: string }[] = [
  { value: "read-only", label: "只读：只能看，不能改" },
  { value: "workspace-write", label: "可写工作目录（推荐）" },
  { value: "full", label: "完全放行（危险）" },
];

interface PanelProps {
  boot: Bootstrap;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

export function EmployeesPanel({ boot, onClose, onChanged }: PanelProps) {
  const [draft, setDraft] = useState<CreateEmployeePayload>({
    displayName: "",
    framework: "codex",
    permissionMode: "workspace-write",
  });
  const [error, setError] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [memory, setMemory] = useState<Record<string, MemorySnapshot>>({});
  const [purgeTarget, setPurgeTarget] = useState<Employee | null>(null);

  const loadMemory = async (): Promise<void> => {
    try {
      const snapshots = await Promise.all(
        [...boot.employees, ...boot.removedEmployees].map(
          async (employee) => [employee.id, await api.memoryList(employee.id)] as const,
        ),
      );
      setMemory(Object.fromEntries(snapshots));
    } catch (cause) {
      setError(`读取记忆失败：${String(cause)}`);
    }
  };

  /** 界面上的写操作统一在这里落地失败提示，避免点下去毫无反应。 */
  const runGuarded = (action: Promise<unknown>): void => {
    void action.catch((cause: unknown) => setError(String(cause)));
  };

  useEffect(() => {
    void loadMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.employees.length]);

  const create = async (): Promise<void> => {
    if (draft.displayName.trim() === "") {
      setError("请填写员工名");
      return;
    }
    try {
      await api.createEmployee({
        ...draft,
        skills: selectedSkills,
      });
      setDraft({ displayName: "", framework: "codex", permissionMode: "workspace-write" });
      setSelectedSkills([]);
      setError(null);
      await onChanged();
    } catch (cause) {
      setError(String(cause));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>员工管理</h2>
        <p className="sub">
          同一个框架可以创建多名员工，彼此完全独立：各自的工作目录、会话与权限。
        </p>

        {boot.employees.map((employee) => (
          <div key={employee.id} className="card">
            <DragHandle />
            <div className="row">
              <div className="grow">
                <strong>{employee.displayName}</strong>
                <span className="tag" style={{ marginLeft: 8 }}>
                  {employee.framework}
                </span>
                <span className="tag" style={{ marginLeft: 4 }}>
                  {employee.permissions.mode}
                </span>
                {employee.sessionRef && (
                  <span className="tag ok" style={{ marginLeft: 4 }}>
                    有会话
                  </span>
                )}
              </div>
              <button
                title="从名册移除，聊天记录与记忆都保留"
                onClick={() => {
                  runGuarded(api.removeEmployee(employee.id).then(onChanged));
                }}
              >
                移除
              </button>
              <button
                className="danger"
                title="连同记忆与一对一聊天记录一起删除"
                onClick={() => setPurgeTarget(employee)}
              >
                彻底删除
              </button>
            </div>
            <div className="skill-inline" style={{ marginTop: 6 }}>
              <span className="sub">
                记忆 {memory[employee.id]?.count ?? 0} 条
                {(memory[employee.id]?.pendingCount ?? 0) > 0
                  ? ` · 待归纳 ${memory[employee.id]?.pendingCount} 条`
                  : ""}
              </span>
              <span className="sub">
                技能 {employee.skills.length} / {boot.skills.length}
              </span>
              {employee.canHire && <span className="tag ok">可招人</span>}
              {employee.sessionRef && <span className="sub">有进行中的会话</span>}
            </div>
            <details className="emp-details">
              <summary>工作目录、技能与记忆管理</summary>
              <div className="sub mono">{employee.workspaceDir}</div>
              <Switch
                label="可以申请招人（模拟 HR）"
                hint="打开后，它才拿得到招人协议；提交的申请仍需你点允许才会创建"
                checked={employee.canHire}
                onChange={(value) => {
                  runGuarded(api.updateEmployee(employee.id, { canHire: value }).then(onChanged));
                }}
              />
            {boot.skills.length > 0 && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  启用技能（{employee.skills.length} / {boot.skills.length}）
                </label>
                {/* 用纵向列表而不是换行的胶囊墙：几十个技能时才能扫读、才能对齐 */}
                <div className="skill-list">
                  {boot.skills.map((skill) => (
                    <label key={skill.id} className="skill">
                      <input
                        type="checkbox"
                        checked={employee.skills.includes(skill.id)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...employee.skills, skill.id]
                            : employee.skills.filter((id) => id !== skill.id);
                          runGuarded(
                            api.updateEmployee(employee.id, { skills: next }).then(onChanged),
                          );
                        }}
                      />
                      <span>
                        <strong>{skill.id}</strong>
                        {skill.source === "buddy" && (
                          <span className="tag ok" style={{ marginLeft: 6 }}>
                            本地
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  长期记忆（{memory[employee.id]?.count ?? 0} 条
                  {(memory[employee.id]?.pendingCount ?? 0) > 0
                    ? ` · 待归纳 ${memory[employee.id]?.pendingCount} 条`
                    : ""}
                  ）
                </label>
                {(memory[employee.id]?.facts.length ?? 0) === 0 ? (
                  <div className="sub">
                    还没有归纳出长期记忆。员工的往来会先进暂存区，攒够条数才归纳成这里的记忆。
                  </div>
                ) : (
                  <div className="memory-list">
                    {(memory[employee.id]?.facts ?? []).map((fact) => (
                      <div key={fact.id} className="memory-item">
                        <span className={`tag${fact.kind === "digest" ? "" : " ok"}`}>
                          {fact.kind === "digest" ? "摘要" : "事实"}
                        </span>
                        <span className="memory-text">{fact.text}</span>
                        <span className="memory-time">
                          {fact.createdAt.slice(5, 16).replace("T", " ")}
                        </span>
                        <button
                          className="chip-x"
                          title="忘掉这一条"
                          onClick={() => {
                            runGuarded(api.forgetFact(employee.id, fact.id).then(loadMemory));
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {(memory[employee.id]?.pendingCount ?? 0) > 0 && (
                  <div className="sub" style={{ marginTop: 6 }}>
                    最近一条待归纳：
                    {(memory[employee.id]?.pending[0]?.text ?? "").slice(0, 80)}
                  </div>
                )}
                {(memory[employee.id]?.count ?? 0) > 0 && (
                  <div className="skill-inline" style={{ marginTop: 8 }}>
                    <button
                      onClick={() => {
                        runGuarded(api.memoryClear(employee.id).then(loadMemory));
                      }}
                    >
                      清空全部记忆
                    </button>
                  </div>
                )}
              </div>
            </details>
          </div>
        ))}
        {boot.employees.length === 0 && <p className="sub">还没有员工。</p>}

        {boot.removedEmployees.length > 0 && (
          <>
            <h2 style={{ marginTop: 18, fontSize: 15 }}>已移除（聊天记录保留）</h2>
            <p className="sub">
              这些员工已离开名册，不会再被 @ 到，也不能派新活；但历史消息仍能正常显示它们原来的名字。
            </p>
            {boot.removedEmployees.map((employee) => (
              <div key={employee.id} className="card">
                <DragHandle />
                <div className="row">
                  <div className="grow">
                    <strong>{employee.displayName}</strong>
                    <span className="tag" style={{ marginLeft: 8 }}>
                      {employee.framework}
                    </span>
                    <span className="tag bad" style={{ marginLeft: 4 }}>
                      已移除
                    </span>
                  </div>
                  <button
                    onClick={() => runGuarded(api.restoreEmployee(employee.id).then(onChanged))}
                  >
                    恢复
                  </button>
                  <button className="danger" onClick={() => setPurgeTarget(employee)}>
                    彻底删除
                  </button>
                </div>
                <div className="sub">
                  移除于 {(employee.removedAt ?? "").slice(0, 10)} · 记忆{" "}
                  {memory[employee.id]?.count ?? 0} 条
                </div>
              </div>
            ))}
          </>
        )}

        {purgeTarget && (
          <ConfirmDialog
            title={`彻底删除「${purgeTarget.displayName}」？`}
            body="会删除：员工档案、它的全部记忆、与它的一对一聊天记录（群聊里的历史消息保留，只把它移出成员）。工作目录留在磁盘上不会动。此操作不可撤销。"
            confirmLabel="彻底删除"
            onCancel={() => setPurgeTarget(null)}
            onConfirm={() => {
              const target = purgeTarget;
              setPurgeTarget(null);
              void api
                .purgeEmployee(target.id)
                .then(async (result) => {
                  await onChanged();
                  window.alert(
                    `已彻底删除「${target.displayName}」。\n\n工作目录仍在：\n${result.workspaceDir}\n（里面可能有你的文件，所以没有自动删除）`,
                  );
                })
                .catch((cause: unknown) => setError(String(cause)));
            }}
          />
        )}

        <h2 style={{ marginTop: 18 }}>新建员工</h2>
        <div className="grid2">
          <div className="field">
            <label>员工名（房间内用 @这个名字 指派）</label>
            <input
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              placeholder="例如 小码"
            />
          </div>
          <div className="field">
            <label>框架</label>
            <select
              value={draft.framework}
              onChange={(event) =>
                setDraft({ ...draft, framework: event.target.value as Framework })
              }
            >
              {frameworks.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                  {boot.frameworks[item.value]
                    ? boot.frameworks[item.value]?.status === "found"
                      ? "（已就绪）"
                      : "（未找到）"
                    : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>模型（留空用框架默认）</label>
            <input
              value={draft.model ?? ""}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              placeholder="例如 gpt-5"
            />
          </div>
          <div className="field">
            <label>权限</label>
            <select
              value={draft.permissionMode}
              onChange={(event) =>
                setDraft({ ...draft, permissionMode: event.target.value as PermissionMode })
              }
            >
              {permissionModes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>职责 / 人设（可选）</label>
          <textarea
            value={draft.systemPrompt ?? ""}
            onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
            placeholder="你是资深后端工程师，只关注正确性与性能。"
          />
        </div>
        <div className="field">
          <label>可用技能（勾选要启用的）</label>
          {boot.skills.length === 0 ? (
            <div className="sub">
              没有发现技能。把技能放进数据目录的 <code>skills\&lt;名称&gt;\SKILL.md</code>，
              或在设置里添加技能根目录。
            </div>
          ) : (
            <SkillPicker
              skills={boot.skills}
              selected={selectedSkills}
              onChange={setSelectedSkills}
            />
          )}
        </div>

        <div className="row">
          <button className="primary" onClick={() => void create()}>
            创建员工
          </button>
          <button onClick={onClose}>关闭</button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

function SkillPicker({
  skills,
  selected,
  onChange,
}: {
  skills: Bootstrap["skills"];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="skill-list">
      {skills.map((skill) => (
        <label key={skill.id} className="skill">
          <input
            type="checkbox"
            checked={selected.includes(skill.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, skill.id]
                  : selected.filter((id) => id !== skill.id),
              )
            }
          />
          <span>
            <strong>{skill.id}</strong>
            {skill.source === "buddy" && (
              <span className="tag ok" style={{ marginLeft: 6 }}>
                本地
              </span>
            )}
            {skill.description && <div className="sub">{skill.description}</div>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function SettingsPanel({ boot, onClose, onChanged }: PanelProps) {
  const [config, setConfig] = useState<BuddyConfig>(boot.config);
  const [frameworks, setFrameworks] = useState(boot.frameworks);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  const flash = (message: string): void => {
    setSaved(message);
    setTimeout(() => setSaved(null), 2500);
  };

  const save = async (): Promise<void> => {
    const patch: DeepPartial<BuddyConfig> = {
      launchers: config.launchers,
      scheduler: config.scheduler,
      policy: config.policy,
      builtinAgent: config.builtinAgent,
      memory: config.memory,
      skills: config.skills,
      ui: config.ui,
    };
    try {
      const next = await api.updateSettings(patch);
      setConfig(next);
      flash("已保存");
      setError(null);
      await onChanged();
    } catch (cause) {
      // 常见触发：数字输入框被清空 → 0 无法通过校验。必须让用户看见，而不是静默失败。
      setSaved(null);
      setError(`保存失败：${String(cause)}`);
    }
  };

  // 密钥写进去就再也不回显：界面只知道「设没设」，明文只在主进程与加密文件之间流动。
  const saveApiKey = async (): Promise<void> => {
    try {
      await api.setBuiltinApiKey(apiKeyDraft.trim());
      setApiKeyDraft("");
      setError(null);
      flash("密钥已保存");
      await onChanged();
    } catch (cause) {
      setError(`保存密钥失败：${String(cause)}`);
    }
  };

  const clearApiKey = async (): Promise<void> => {
    try {
      await api.setBuiltinApiKey(null);
      setApiKeyDraft("");
      setError(null);
      flash("密钥已清除");
      await onChanged();
    } catch (cause) {
      setError(`清除密钥失败：${String(cause)}`);
    }
  };

  const probe = async (): Promise<void> => {
    setFrameworks(await api.probeLaunchers());
  };

  const setScheduler = (key: keyof BuddyConfig["scheduler"], value: number): void => {
    setConfig({ ...config, scheduler: { ...config.scheduler, [key]: value } });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>设置</h2>
        <p className="sub">数据目录：{boot.dataDir}</p>

        <details className="settings-group">
          <summary>启动器（Codex / Claude Code 路径）</summary>
          <div className="group-body">
        {(["codex", "claude-code"] as const).map((framework) => (
          <div key={framework} className="card">
            <div className="row">
              <div className="grow">
                <strong>{framework}</strong>
                <span
                  className={`tag ${frameworks[framework]?.status === "found" ? "ok" : "bad"}`}
                  style={{ marginLeft: 8 }}
                >
                  {frameworks[framework]?.status === "found" ? "已找到" : "未找到"}
                </span>
              </div>
              <button onClick={() => void probe()}>重新探测</button>
            </div>
            <div className="sub" style={{ margin: "6px 0" }}>
              {frameworks[framework]?.detail}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>手动指定可执行文件（留空自动探测）</label>
              <input
                value={config.launchers[framework].executablePath ?? ""}
                placeholder="例如 C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\...\\codex.exe"
                onChange={(event) =>
                  setConfig({
                    ...config,
                    launchers: {
                      ...config.launchers,
                      [framework]: {
                        ...config.launchers[framework],
                        executablePath: event.target.value.trim() || null,
                      },
                    },
                  })
                }
              />
            </div>
            <Switch
              label="在 WSL 里也探测"
              checked={config.launchers[framework].detectWsl}
              onChange={(value) =>
                setConfig({
                  ...config,
                  launchers: {
                    ...config.launchers,
                    [framework]: { ...config.launchers[framework], detectWsl: value },
                  },
                })
              }
            />
          </div>
        ))}

        </div></details>

        <details className="settings-group">
          <summary>策略（谁可以自动触发谁）</summary>
          <div className="group-body">
        <div className="card">
          {(
            [
              ["employeeMentionsEmployee", "员工 @ 员工时"],
              ["employeeMentionsAll", "员工 @全体时"],
              ["humanMentionsEmployee", "你 @员工时"],
            ] as const
          ).map(([key, label]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <select
                value={config.policy[key]}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    policy: { ...config.policy, [key]: event.target.value as "auto" | "confirm" },
                  })
                }
              >
                <option value="auto">自动执行</option>
                <option value="confirm">需要我确认</option>
              </select>
            </div>
          ))}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>新员工的默认权限</label>
            <select
              value={config.policy.defaultPermissionMode}
              onChange={(event) =>
                setConfig({
                  ...config,
                  policy: {
                    ...config.policy,
                    defaultPermissionMode: event.target.value as PermissionMode,
                  },
                })
              }
            >
              {permissionModes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        </div></details>

        <details className="settings-group">
          <summary>调度与刹车（并发、预算、去重）</summary>
          <div className="group-body">
        <div className="grid2">
          {(
            [
              ["maxConcurrentRuns", "同时运行上限"],
              ["maxRunsPerTurn", "每轮运行上限"],
              ["maxMentionDepth", "@ 接续层数上限"],
              ["dedupeWindowMs", "重复消息去重窗口(ms)"],
              ["wallClockBudgetMs", "单次运行超时(ms)"],
              ["contextWindowMessages", "房间上下文条数"],
            ] as const
          ).map(([key, label]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <input
                type="number"
                value={config.scheduler[key]}
                onChange={(event) => setScheduler(key, Number(event.target.value))}
              />
            </div>
          ))}
        </div>

        </div></details>

        <details className="settings-group">
          <summary>员工记忆（归纳、阈值、注入条数）</summary>
          <div className="group-body">
        <div className="card">
          <Switch
            label="启用员工记忆"
            hint="每次往来先进暂存区，归纳后才成为长期记忆"
            checked={config.memory.enabled}
            onChange={(value) =>
              setConfig({ ...config, memory: { ...config.memory, enabled: value } })
            }
          />
          <Switch
            label="单聊与群聊的记忆互相可见"
            hint="关掉则只在同一房间内回忆"
            checked={config.memory.crossRoomRecall}
            onChange={(value) =>
              setConfig({ ...config, memory: { ...config.memory, crossRoomRecall: value } })
            }
          />
          <div className="grid2" style={{ marginTop: 12 }}>
            {(
              [
                ["distillAfterPending", "累计多少次往来后归纳"],
                ["maxFacts", "长期记忆条数上限"],
                ["maxInjectedFacts", "每次运行注入条数"],
              ] as const
            ).map(([key, label]) => (
              <div className="field" key={key}>
                <label>{label}</label>
                <input
                  type="number"
                  value={config.memory[key]}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      memory: { ...config.memory, [key]: Number(event.target.value) },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        </div></details>

        <details className="settings-group">
          <summary>技能目录</summary>
          <div className="group-body">
        <div className="card">
          <Switch
            label="复用框架自带的技能"
            hint="同时扫描 ~/.codex/skills、~/.agents/skills、~/.claude/skills"
            checked={config.skills.includeFrameworkSkills}
            onChange={(value) =>
              setConfig({
                ...config,
                skills: { ...config.skills, includeFrameworkSkills: value },
              })
            }
          />
          <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
            <label>额外技能根目录（一行一个）</label>
            <textarea
              value={config.skills.extraRoots.join("\n")}
              placeholder="E:\my-skills"
              onChange={(event) =>
                setConfig({
                  ...config,
                  skills: {
                    ...config.skills,
                    extraRoots: event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line !== ""),
                  },
                })
              }
            />
          </div>
          <div className="sub">
            当前发现 {boot.skills.length} 个技能；每个技能是一个含 SKILL.md 的子目录。
          </div>
        </div>

        </div></details>

        <details className="settings-group">
          <summary>数据位置</summary>
          <div className="group-body">
        <div className="card">
          <div className="sub" style={{ marginBottom: 6 }}>
            当前数据目录：{boot.dataDir}
          </div>
          <div className="field">
            <label>自定义数据目录（留空用默认位置）</label>
            <input
              value={config.storage.dataDir ?? ""}
              placeholder={boot.bootstrapDir}
              onChange={(event) =>
                setConfig({
                  ...config,
                  storage: { dataDir: event.target.value.trim() || null },
                })
              }
            />
          </div>
          <div className="row">
            <button
              onClick={() => {
                void api
                  .updateSettings({ storage: config.storage })
                  .then(() => api.relaunch())
                  .catch((cause: unknown) => setError(`切换数据目录失败：${String(cause)}`));
              }}
            >
              保存数据目录并重启
            </button>
            <span className="sub">改目录会切换员工、房间、消息与记忆的存放位置，需要重启生效。</span>
          </div>
        </div>

        </div></details>

        <details className="settings-group">
          <summary>内置兜底员工（暂未实现）</summary>
          <div className="group-body">
        <div className="grid2">
          <div className="field">
            <label>Base URL</label>
            <input
              value={config.builtinAgent.baseUrl ?? ""}
              onChange={(event) =>
                setConfig({
                  ...config,
                  builtinAgent: { ...config.builtinAgent, baseUrl: event.target.value || null },
                })
              }
            />
          </div>
          <div className="field">
            <label>模型</label>
            <input
              value={config.builtinAgent.model ?? ""}
              onChange={(event) =>
                setConfig({
                  ...config,
                  builtinAgent: { ...config.builtinAgent, model: event.target.value || null },
                })
              }
            />
          </div>
          <div className="field">
            <label>API Key（存进系统安全存储，界面不回显）</label>
            <input
              type="password"
              value={apiKeyDraft}
              placeholder={boot.builtinApiKeySet ? "已设置，输入新值可覆盖" : "未设置"}
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
          </div>
        </div>
        <div className="skill-inline" style={{ marginTop: 8 }}>
          <button disabled={apiKeyDraft.trim() === ""} onClick={() => void saveApiKey()}>
            保存密钥
          </button>
          {boot.builtinApiKeySet && <button onClick={() => void clearApiKey()}>清除密钥</button>}
          <span className="sub">{boot.builtinApiKeySet ? "当前：已设置" : "当前：未设置"}</span>
        </div>

        </div></details>

        <div className="row">
          <button className="primary" onClick={() => void save()}>
            保存
          </button>
          <button onClick={onClose}>关闭</button>
          {saved && <span className="tag ok">{saved}</span>}
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

