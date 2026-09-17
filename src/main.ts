import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { HttpStatusInterceptor } from './common/http-status.interceptor';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  const origin = env.corsOrigin
    ? env.corsOrigin.split(',').map((s) => s.trim())
    : true;
  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

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
  app.useStaticAssets(uploadsDir, { prefix: '/' + env.uploadDir });
  app.useStaticAssets(documentsDir, { prefix: '/' + env.documentDir });
  // sitemap 目录对外暴露，使 /sitemap.xml 及分页文件可被搜索引擎访问
  app.useStaticAssets(sitemapDir, { prefix: '/sitemap' });

  await app.listen(env.port);
  console.log(`[moredoc-server] listening on http://localhost:${env.port}`);
}

bootstrap();