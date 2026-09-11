import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { Biz } from '../../common/biz.exception';

/**
 * 附件管理 API 控制器。
 * 路由前缀：/api/v1/attachment，对应 proto 中的 AttachmentAPI。
 */
@Controller('attachment')
export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}

  @RequirePermission('/api.v1.AttachmentAPI/UpdateAttachment')
  @Put()
  async update(@Body() body: Record<string, any>) {
    await this.service.updateAttachment(
      Number(body.id) || 0,
      String(body.name ?? ''),
      body.enable === undefined ? true : Boolean(body.enable),
      String(body.description ?? ''),
    );
    return {};
  }

  @Delete()
  // 与原版保持一致：附件由系统直接管理，不允许直接删除。
  delete() {
    throw Biz.internal(
      '附件不允许直接删除。附件由系统直接管理，会随着相应数据的删除而自动删除。',
    );
  }

  @RequirePermission('/api.v1.AttachmentAPI/GetAttachment')
  @Get()
  get(@Query('id') id: unknown) {
    return this.service.getAttachment(Number(id) || 0);
  }

  @RequirePermission('/api.v1.AttachmentAPI/ListAttachment')
  @Get('list')
  list(@Query() query: Record<string, any>) {
    return this.service.listAttachment(query);
  }
}