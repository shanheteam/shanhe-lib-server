// 防回潮检查：服务端源文件必须对「同组 / 其他用户」可读（常规为 644，目录为 755）。
//
// 为什么服务端尤其重要：生产用 PM2 以非 root 用户（如 www）运行 start.js，
// 由 ts-node 直接加载 src/**.ts。任何一个新增文件权限过紧（例如 600），
// 启动时就会抛 Error: EACCES: permission denied, open '.../src/xxx.ts'，
// 进程起不来 → nginx 502 → 浏览器把它报成 CORS 错误，真实原因极难定位。
// 本项目已发生过一次（src/common/credit.constant.ts）。
//
// 有意排除 .env：密钥文件 600 属于合理配置，且由部署方按运行用户设置。
//
// 用法：node scripts/check-file-modes.mjs
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SERVER = resolve(import.meta.dirname, '..')
const TARGETS = ['src', 'start.js', 'package.json']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'cache', 'uploads', 'documents', 'sitemap'])

function walk(p, out = []) {
  let st
  try {
    st = statSync(p)
  } catch {
    return out
  }
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(p.split('/').pop())) return out
    out.push({ p, mode: st.mode & 0o777, dir: true })
    for (const f of readdirSync(p)) walk(join(p, f), out)
  } else {
    out.push({ p, mode: st.mode & 0o777, dir: false })
  }
  return out
}

const violations = []
for (const t of TARGETS) {
  for (const e of walk(join(SERVER, t))) {
    const need = e.dir ? 0o011 : 0o044
    if ((e.mode & need) !== need) {
      const want = e.dir ? '755' : '644'
      violations.push(
        `${e.p.replace(SERVER + '/', '')}  当前 ${e.mode.toString(8).padStart(3, '0')}，应为 ${want}`,
      )
    }
  }
}

if (violations.length) {
  console.error('[check-file-modes] 检查未通过：以下文件/目录权限过紧，运行用户可能无法读取')
  for (const v of violations) console.error(`  ${v}`)
  console.error('\n修复：chmod 644 <文件>  /  chmod 755 <目录>')
  console.error('（否则 PM2 启动时会因 EACCES 崩溃，表现为 nginx 502）')
  process.exit(1)
}
console.log('[check-file-modes] 通过：服务端源文件均为 644、目录均为 755')
