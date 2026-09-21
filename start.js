/**
 * 宝塔/PM2 启动入口：直接运行 TypeScript 源码，无需 npm run build。
 * 先注册 ts-node 运行时编译，再加载 src/main.ts。
 * 注意：运行目录（cwd）必须指向本文件所在目录（server 根目录），
 * 因为 main.ts 用 process.cwd() 解析 uploads/documents/ sitemap 等相对路径。
 */
// transpileOnly 只做转译、跳过类型检查，显著加快 ts-node 运行时编译；
// 若希望启动时仍保留类型检查可去掉该选项（代价是启动更慢）。
require('ts-node').register({
  project: require('path').join(__dirname, 'tsconfig.json'),
  transpileOnly: true,
});

require('./src/main.ts');