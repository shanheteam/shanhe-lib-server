import {
  Controller,
  Ip,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AttachmentService } from './attachment.service';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { Biz } from '../../common/biz.exception';

const FILE_OPTIONS = { storage: memoryStorage() };

/**
 * 文件上传控制器。
 * 路由前缀：/api/v1/upload，与原版 gin 路由保持一致。
 */
@Controller('upload')
export class UploadController {
  constructor(private readonly service: AttachmentService) {}

  private async ensureImagePermission(user: JwtUser | undefined, httpPath: string) {
    const userId = user?.userId ?? 0;
    // 头像上传只需登录；其余图片上传需按 HTTP path 校验权限。
    if (await this.service.checkUploadPermission(userId, httpPath)) return;
    throw Biz.permissionDenied('您没有权限执行此操作');
  }

  @RequireLogin()
  @Post('document')
  @UseInterceptors(FileInterceptor('file', FILE_OPTIONS))
  uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Ip() ip: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.uploadDocument(file, ip || '', user?.userId ?? 0);
  }

  @RequireLogin()
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', FILE_OPTIONS))
  uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Ip() ip: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.uploadImage(file, ip || '', user?.userId ?? 0, 1);
  }

  @RequireLogin()
  @Post('config')
  @UseInterceptors(FileInterceptor('file', FILE_OPTIONS))
  async uploadConfig(
    @UploadedFile() file: Express.Multer.File,
    @Ip() ip: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.ensureImagePermission(user, '/api/v1/upload/config');
    return this.service.uploadImage(file, ip || '', user?.userId ?? 0, 7);
  }

  @RequireLogin()
  @Post('banner')
  @UseInterceptors(FileInterceptor('file', FILE_OPTIONS))
  async uploadBanner(
    @UploadedFile() file: Express.Multer.File,
    @Ip() ip: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.ensureImagePermission(user, '/api/v1/upload/banner');
    return this.service.uploadImage(file, ip || '', user?.userId ?? 0, 5);
  }

  @RequireLogin()
  @Post('category')
  @UseInterceptors(FileInterceptor('file', FILE_OPTIONS))
  async uploadCategory(
    @UploadedFile() file: Express.Multer.File,
    @Ip() ip: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.ensureImagePermission(user, '/api/v1/upload/category');
    return this.service.uploadImage(file, ip || '', user?.userId ?? 0, 6);
  }

  @RequireLogin()
  @Post('article')
  @UseInterceptors(FileInterceptor('file', FILE_OPTIONS))
  async uploadArticle(
    @UploadedFile() file: Express.Multer.File,
    @Query('type') type: string,
    @Ip() ip: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.ensureImagePermission(user, '/api/v1/upload/article');
    if (type !== 'image' && type !== 'video') {
      return { errno: 1, msg: '类型参数错误' };
    }
    return this.service.uploadArticle(file, ip || '', user?.userId ?? 0);
  }
}