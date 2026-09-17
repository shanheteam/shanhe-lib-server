import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** 邮件服务模块：与 ConfigService 一样作为全局基础设施供各业务模块注入 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}