import { useState, type CSSProperties, type ReactNode } from "react";

/**
 * 内联 SVG 图标集：不引第三方图标库，统一 1.7px 描边 + 圆头，跟着 currentColor 走。
 */
interface IconProps {
  size?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };
}

export const PlusIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const UsersIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19" />
    <circle cx="9.5" cy="7" r="3.2" />
    <path d="M21 19v-1.2a3.6 3.6 0 0 0-2.8-3.5M15.5 4.3a3.2 3.2 0 0 1 0 6.2" />
  </svg>
);

export const GearIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const StopIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.6" />
  </svg>
);

export const SendIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const TrashIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h7.2A1.6 1.6 0 0 0 17.2 19L18 7" />
  </svg>
);

export const SparkIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9Z" />
    <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" />
  </svg>
);

export const MemoryIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.6A3 3 0 0 0 7 18.5a3 3 0 0 0 5 1.6V4.9A2.4 2.4 0 0 0 9 4.5Z" />
    <path d="M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.6A3 3 0 0 1 17 18.5" />
  </svg>
);

export const WandIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M15 4V2.5M15 21.5V20M4 12H2.5M21.5 12H20M6.3 6.3 5.2 5.2M24.8 18.8l-1.1-1.1M6.3 17.7l-1.1 1.1" />
    <path d="m14.5 9.5-8 8a1.8 1.8 0 0 0 2.5 2.5l8-8Z" />
  </svg>
);

export const FolderIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h3.2a1.5 1.5 0 0 1 1.2.6l.9 1.2h8.7A1.5 1.5 0 0 1 21 9.3v7.2A1.5 1.5 0 0 1 19.5 18h-14A1.5 1.5 0 0 1 4 16.5Z" />
  </svg>
);

export const AlertIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 8.5v4.2M12 16.4h.01" />
    <path d="M10.6 3.9 2.9 17.2A1.6 1.6 0 0 0 4.3 19.6h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 3.9a1.6 1.6 0 0 0-2.8 0Z" />
  </svg>
);

export const PaperclipIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 11.5 12.3 19.2a4.6 4.6 0 0 1-6.5-6.5l7.6-7.6a3.1 3.1 0 1 1 4.4 4.4l-7.6 7.6a1.6 1.6 0 0 1-2.2-2.2l7-7" />
  </svg>
);

export const FileIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5Z" />
    <path d="M13.5 3.5v5h5" />
  </svg>
);

/** 六点抓取手柄：两个点阵列，Notion 列表块的标志。 */
export const GripIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}>
    <path d="M9 6.5h.01M9 12h.01M9 17.5h.01M15 6.5h.01M15 12h.01M15 17.5h.01" />
  </svg>
);

/** 中文取前两字，拉丁按词取首字母，最多两位。 */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "?";
  if (/\p{Script=Han}/u.test(trimmed)) return trimmed.slice(0, 2);
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Notion 标签色：浅底配深字，每组都满足 AA 对比度；刻意不用渐变。 */
const TINTS = [
  { bg: "#f1f1ef", ink: "#5a5955" }, // 灰
  { bg: "#f3eeea", ink: "#6b4a2f" }, // 棕
  { bg: "#fbebd9", ink: "#8a5a1f" }, // 橙
  { bg: "#fbf3db", ink: "#6b5518" }, // 黄
  { bg: "#edf3ec", ink: "#2f5e46" }, // 绿
  { bg: "#e7f3f8", ink: "#1a5a75" }, // 蓝
  { bg: "#f4f0f7", ink: "#5b4a72" }, // 紫
  { bg: "#f9eef3", ink: "#7a4258" }, // 粉
  { bg: "#fdebec", ink: "#8c3836" }, // 红
] as const;

/** 由 id 稳定推导出一组标签色，保证同一位员工/房间始终同色。 */
export function tintFor(seed: string): CSSProperties {
  let hash = 7;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973;
  }
  const tint = TINTS[hash % TINTS.length] ?? TINTS[0];
  return { background: tint.bg, color: tint.ink };
}

export function Avatar({
  name,
  seed,
  small = false,
}: {
  name: string;
  seed: string;
  small?: boolean;
}) {
  return (
    <div className={`avatar${small ? " sm" : ""}`} style={tintFor(seed)} title={name}>
      {initials(name)}
    </div>
  );
}

/**
 * Drag Handle Illusion：默认不可见，父级（列表项/卡片/消息行）悬停时才淡入。
 * 只改 opacity，不参与布局，所以悬停时不会推动任何内容。
 */
export function DragHandle() {
  return (
    <span className="drag-handle" aria-hidden="true">
      <GripIcon />
    </span>
  );
}

/** iOS 风格开关，label 与说明统一走这里，避免各处自己拼。 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="switch">
      <span>
        <div className="switch-text">{label}</div>
        {hint && <div className="switch-hint">{hint}</div>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="art">{icon}</div>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/**
 * 侧栏可折叠分区。展开状态记在 localStorage，重启后保持。
 */
export function Section({
  title,
  count,
  storageKey,
  children,
}: {
  title: string;
  count?: number;
  storageKey: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== "0";
    } catch {
      return true;
    }
  });

  const toggle = (): void => {
    setOpen((prev) => {
      try {
        localStorage.setItem(storageKey, prev ? "0" : "1");
      } catch {
        // 隐私模式下写不了 localStorage，忽略即可。
      }
      return !prev;
    });
  };

  return (
    <section className="nav-section">
      <button className="nav-section-head" onClick={toggle} aria-expanded={open}>
        <span className={open ? "chevron open" : "chevron"} />
        {title}
        {count !== undefined && <span className="count-pill">{count}</span>}
      </button>
      {open && <div className="nav-section-body">{children}</div>}
    </section>
  );
}
