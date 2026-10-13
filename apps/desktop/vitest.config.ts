import { defineConfig } from "vitest/config";

export default defineConfig({
  // 渲染层是 React：源码里不 import React（只有 hooks），所以 JSX 必须走 automatic runtime。
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
