import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';

/**
 * 全局状态码归一化：NestJS 的 @Post() 默认返回 201 Created，
 * 而原版（grpc-gateway）及前端约定成功统一为 200。
 * 这里将 201 归一化为 200，避免前端 `res.status === 200` 判空失败。
 */
@Injectable()
export class HttpStatusInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse<Response>();
        if (response.statusCode === 201) {
          response.status(200);
        }
        return data;
      }),
    );
  }
}