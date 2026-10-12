import { useState, type ReactNode } from "react";

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

/** 由 id 稳定推导出一个色相，保证同一位员工/房间始终同色。 */
export function tintFor(seed: string): string {
  let hash = 7;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return `linear-gradient(150deg, oklch(0.68 0.085 ${hash}), oklch(0.52 0.075 ${(hash + 34) % 360}))`;
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
    <div className={`avatar${small ? " sm" : ""}`} style={{ background: tintFor(seed) }} title={name}>
      {initials(name)}
    </div>
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

/** iOS 分段控件：用于主题这类互斥的少量选项。 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
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
