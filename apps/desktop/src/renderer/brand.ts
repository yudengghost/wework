/**
 * Wework 标识的几何：一个「W」加一条等宽底座组成的皇冠，只用描边所以内里中空。
 *
 * 这些数字必须与 apps/desktop/assets/wework-icon.svg 完全一致——那份是图标文件
 * （PNG / ICO 的源头），这里只是界面里内联渲染用的同一套坐标。brand.test.ts 会把两张表对起来。
 */
export const weworkBrand = {
  /** 由 scripts/build-icon.mjs 按整体墨迹外接框校正出来的正方形。 */
  viewBox: "5.625 7.25 52.75 52.75",
  strokeWidth: 5,
  /** W 的三处峰与两处谷。 */
  points: "8 13 21 36 32 13 43 36 56 13",
  /**
   * W 连描边在内的墨迹宽度（scripts/build-icon.mjs 实测值）。
   * 底座的墨迹宽度要等于它，两者的墨迹边缘才是齐的。
   */
  inkWidth: 52.5,
  /** 底座：宽度与 W 的横向跨度一致，中间留出可见的间隙。 */
  base: { x: 8.25, y: 47.5, width: 47.5, height: 10 },
} as const;
