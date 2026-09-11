import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { BizException } from './biz.exception';
import { grpcCodeToHttp } from './grpc-code';

/**
 * 全局异常过滤器：将 BizException / HttpException / 未知异常
 * 统一转换为前端可识别的 `{ code, message, details? }` 结构。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown>;

    if (exception instanceof BizException) {
      status = grpcCodeToHttp(exception.code);
      body = { code: exception.code, message: exception.message };
      if (exception.details !== undefined) body.details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        body = { code: status, message: res };
      } else if (res && typeof res === 'object') {
        const r = res as Record<string, unknown>;
        const message = Array.isArray(r.message) ? r.message.join('; ') : (r.message as string);
        body = { code: status, message: message || exception.message, details: r.details };
      } else {
        body = { code: status, message: exception.message };
      }
    } else {
      const message = exception instanceof Error ? exception.message : '服务器内部错误';
      body = { code: HttpStatus.INTERNAL_SERVER_ERROR, message };
    }

    response.status(status).json(body);
  }
}