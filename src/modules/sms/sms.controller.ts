import { Body, Controller, Delete, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { toNumberArray } from '../../common/query.util';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  constructor(private readonly service: SmsService) {}

  @Get('list')
  @RequirePermission('/api.v1.SmsAPI/ListSms')
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Get()
  @RequirePermission('/api.v1.SmsAPI/GetSms')
  get(@Query('id') id: string) {
    return this.service.get(Number(id));
  }

  @Delete()
  @RequirePermission('/api.v1.SmsAPI/DeleteSms')
  remove(@Query('id') id: unknown) {
    return this.service.remove(toNumberArray(id));
  }

  @Public()
  @Post()
  send(@Body() body: { mobile?: string; type?: number }, @Req() req: Request) {
    return this.doSend(body, req);
  }

  // 兼容旧版核心前端的发送路径
  @Public()
  @Post('send')
  sendLegacy(@Body() body: { mobile?: string; type?: number }, @Req() req: Request) {
    return this.doSend(body, req);
  }

  private doSend(body: { mobile?: string; type?: number }, req: Request) {
    const ip =
      String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.ip ||
      '';
    return this.service.send({ mobile: body?.mobile ?? '', type: Number(body?.type), ip });
  }
}
