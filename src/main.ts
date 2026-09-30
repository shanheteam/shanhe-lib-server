import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { HttpStatusInterceptor } from './common/http-status.interceptor';
import { env } from './config/env';

async function bootstrap() {
  // 生产环境收敛日志级别：Nest 默认含 debug/verbose，会让转换器逐条外部命令日志
  // 等在生产持续落盘。仅在 production 下收敛，开发环境保持默认。
  if (env.isProduction) {
    Logger.overrideLogger(['log', 'warn', 'error', 'fatal']);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 部署在 CDN/Nginx 之后时需信任转发头，否则限流会把所有用户算作同一个 IP。
  // 未部署代理时保持关闭，避免客户端伪造 X-Forwarded-For 绕过限流。
  if (env.trustProxy) app.set('trust proxy', 1);

  app.setGlobalPrefix('api/v1', {
    exclude: [
      '/favicon.ico',
      '/view/page/:hash/:page',
      '/view/cover/:hash',
      '/download/:jwt',
    ],
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new HttpStatusInterceptor());
  // 全局参数校验：配合 class-validator DTO 使用，剔除 DTO 上未声明的多余字段。
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: false,
    }),
  );

  // 禁止 CDN 缓存 CORS 相关响应。必须注册在 enableCors 之前：
  // 1) OPTIONS 预检由 cors 中间件直接结束，注册在其后的中间件不会执行；
  // 2) 带 Origin 的跨域响应携带 per-origin 的 Access-Control-Allow-Origin，
  //    CDN 若忽略 Vary: Origin 会按首个来源缓存，其它来源命中后拿到错误的
  //    CORS 头，表现为"间歇性跨域失败"。因此二者都禁止缓存。
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS' || req.headers.origin) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });

  const allowedOrigins = env.corsOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedOrigins.length) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  } else {
    // 未配置 CORS_ORIGIN：允许所有来源，但必须关闭凭据（Cookie）。
    // 前端使用 Authorization 头携带 token，不依赖 Cookie，因此不受影响。
    console.warn(
      '[moredoc] 警告：未配置 CORS_ORIGIN，已允许所有来源访问并禁用凭据；建议在生产环境显式配置允许的来源。',
    );
    app.enableCors({
      origin: true,
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  // 静态资源目录（上传的图片等），运行时自动创建并暴露给前端访问
  const uploadsDir = path.resolve(process.cwd(), env.uploadDir);
  const documentsDir = path.resolve(process.cwd(), env.documentDir);
  const sitemapDir = path.resolve(process.cwd(), 'sitemap');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(documentsDir, { recursive: true });
  fs.mkdirSync(sitemapDir, { recursive: true });
  // 上传目录中的文件类型由用户决定，禁止浏览器按内容嗅探（nosniff），避免被当作脚本执行
  const staticHeaders = (res: { setHeader: (k: string, v: string) => void }) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  };
  app.useStaticAssets(uploadsDir, { prefix: '/' + env.uploadDir, setHeaders: staticHeaders });
  // 注意：documents 目录（文档原文件 + 预览页）刻意不对外静态暴露。
  // 原文件路径可由 md5 推导（documents/{hash 前5位拆目录}/{hash}{ext}），而 hash 会随文档列表/详情
  // 接口下发，静态挂载下任何人拿到 hash 即可直接下载原文件，绕过 /download/:jwt 的登录、积分与
  // 次数校验。预览页与封面已分别由 /view/page/:hash/:page、/view/cover/:hash 用 sendFile 绝对路径提供
  // （见 file.controller.ts），下载走 /download/:jwt，均不依赖静态挂载，故移除不影响任何对外功能。
  // sitemap 目录对外暴露，使 /sitemap.xml 及分页文件可被搜索引擎访问
  app.useStaticAssets(sitemapDir, { prefix: '/sitemap', setHeaders: staticHeaders });

  await app.listen(env.port);
  console.log(`[moredoc-server] listening on http://localhost:${env.port}`);
}

bootstrap();