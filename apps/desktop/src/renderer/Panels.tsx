import type { BuddyConfig, DeepPartial, Framework, PermissionMode } from "@buddy/core";
import { useState } from "react";

import { api, type Bootstrap, type CreateEmployeePayload } from "./api";

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
  const [skills, setSkills] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    if (draft.displayName.trim() === "") {
      setError("请填写员工名");
      return;
    }
    try {
      await api.createEmployee({
        ...draft,
        skills: skills
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item !== ""),
      });
      setDraft({ displayName: "", framework: "codex", permissionMode: "workspace-write" });
      setSkills("");
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
                className="danger"
                onClick={() => {
                  void api.removeEmployee(employee.id).then(onChanged);
                }}
              >
                删除
              </button>
            </div>
            <div className="sub" style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
              {employee.workspaceDir}
            </div>
          </div>
        ))}
        {boot.employees.length === 0 && <p className="sub">还没有员工。</p>}

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
          <label>技能白名单（逗号分隔，可留空）</label>
          <input value={skills} onChange={(event) => setSkills(event.target.value)} />
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

export function SettingsPanel({ boot, onClose, onChanged }: PanelProps) {
  const [config, setConfig] = useState<BuddyConfig>(boot.config);
  const [frameworks, setFrameworks] = useState(boot.frameworks);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const patch: DeepPartial<BuddyConfig> = {
      launchers: config.launchers,
      scheduler: config.scheduler,
      policy: config.policy,
      builtinAgent: config.builtinAgent,
    };
    const next = await api.updateSettings(patch);
    setConfig(next);
    setSaved("已保存");
    setTimeout(() => setSaved(null), 2500);
    await onChanged();
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

        <h2 style={{ fontSize: 14 }}>启动器</h2>
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
            <div className="sub" style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0" }}>
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
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              <input
                type="checkbox"
                style={{ width: "auto", marginRight: 6 }}
                checked={config.launchers[framework].detectWsl}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    launchers: {
                      ...config.launchers,
                      [framework]: {
                        ...config.launchers[framework],
                        detectWsl: event.target.checked,
                      },
                    },
                  })
                }
              />
              在 WSL 里也探测
            </label>
          </div>
        ))}

        <h2 style={{ fontSize: 14 }}>策略</h2>
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

        <h2 style={{ fontSize: 14 }}>调度与刹车</h2>
        <div className="grid2">
          {(
            [
              ["maxConcurrentRuns", "同时运行上限"],
              ["maxRunsPerTurn", "每轮运行上限"],
              ["maxTotalRunsPerRoom", "每房间总运行上限"],
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

        <h2 style={{ fontSize: 14 }}>内置兜底员工（OpenAI 兼容接口）</h2>
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
            <label>API Key</label>
            <input
              type="password"
              value={config.builtinAgent.apiKey ?? ""}
              onChange={(event) =>
                setConfig({
                  ...config,
                  builtinAgent: { ...config.builtinAgent, apiKey: event.target.value || null },
                })
              }
            />
          </div>
        </div>

        <div className="row">
          <button className="primary" onClick={() => void save()}>
            保存
          </button>
          <button onClick={onClose}>关闭</button>
          {saved && <span className="tag ok">{saved}</span>}
        </div>
      </div>
    </div>
  );
}

