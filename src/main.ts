import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { HttpStatusInterceptor } from './common/http-status.interceptor';
import { env } from './config/env';

async function bootstrap() {
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

  // 禁止 CDN 缓存 CORS 预检响应。否则 EdgeOne 等边缘缓存可能命中一个缺失
  // Access-Control-Allow-Origin 头的 OPTIONS 响应，导致浏览器间歇性跨域失败。
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });

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
  app.useStaticAssets(documentsDir, { prefix: '/' + env.documentDir, setHeaders: staticHeaders });
  // sitemap 目录对外暴露，使 /sitemap.xml 及分页文件可被搜索引擎访问
  app.useStaticAssets(sitemapDir, { prefix: '/sitemap', setHeaders: staticHeaders });

  await app.listen(env.port);
  console.log(`[moredoc-server] listening on http://localhost:${env.port}`);
}

bootstrap();