import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { PermissionService } from '../../auth/permission.service';

/**
 * 文档 API 控制器。
 * 路由前缀：/api/v1/document，对应 proto 中的 DocumentAPI 与 RecycleAPI。
 */
@Controller('document')
export class DocumentController {
  constructor(
    private readonly service: DocumentService,
    private readonly permissionService: PermissionService,
  ) {}

  private numArray(v: unknown): number[] {
    if (v === undefined || v === null || v === '') return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  }

  private userIdOf(user?: JwtUser): number {
    return user?.userId ?? 0;
  }

  private async isAdmin(user?: JwtUser): Promise<boolean> {
    if (!user || user.userId <= 0) return false;
    return this.permissionService.isAdmin(user.userId);
  }

  // ---------- 公开查询 ----------

  @Public()
  @Get('home')
  home(@Query() query: Record<string, any>) {
    return this.service.listDocumentForHome(query);
  }

  @Public()
  @Get('list')
  async list(
    @Query() query: Record<string, any>,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.service.listDocument(
      query,
      this.userIdOf(user),
      await this.isAdmin(user),
    );
  }

  @Public()
  @Get('search')
  search(@Query() query: Record<string, any>) {
    return this.service.searchDocument(query);
  }

  @Public()
  @Get('related')
  related(@Query('id') id: unknown) {
    return this.service.getRelatedDocuments(this.numArray(id)[0] || 0);
  }

  @Public()
  @Get()
  async get(
    @Query() query: Record<string, any>,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.service.getDocumentDetail(
      query,
      this.userIdOf(user),
      await this.isAdmin(user),
    );
  }

  // ---------- 登录操作 ----------

  @RequireLogin()
  @Post()
  async create(
    @Body() body: Record<string, any>,
    @CurrentUser() user: JwtUser,
  ) {
    await this.service.createDocument(
      this.userIdOf(user),
      this.numArray(body.category_id),
      Array.isArray(body.document) ? body.document : [],
    );
    return {};
  }

  @RequireLogin()
  @Put()
  async update(
    @Body() body: Record<string, any>,
    @CurrentUser() user: JwtUser,
  ) {
    await this.service.updateDocument(
      this.userIdOf(user),
      await this.isAdmin(user),
      body,
    );
    return {};
  }

  @RequireLogin()
  @Delete()
  async remove(@Query('id') id: unknown, @CurrentUser() user: JwtUser) {
    await this.service.deleteDocument(
      this.userIdOf(user),
      await this.isAdmin(user),
      this.numArray(id),
    );
    return {};
  }

  @RequireLogin()
  @Get('download')
  download(
    @Query('id') id: unknown,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.service.downloadDocument(
      this.numArray(id)[0] || 0,
      this.userIdOf(user),
      ip || '',
    );
  }

  @RequireLogin()
  @Post('score')
  async score(@Body() body: Record<string, any>, @CurrentUser() user: JwtUser) {
    await this.service.setDocumentScore(this.userIdOf(user), body);
    return {};
  }

  @RequireLogin()
  @Get('score')
  getScore(
    @Query('document_id') documentId: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.getDocumentScore(
      this.userIdOf(user),
      this.numArray(documentId)[0] || 0,
    );
  }

  // ---------- 管理操作 ----------

  @RequirePermission('/api.v1.DocumentAPI/SetDocumentRecommend')
  @Put('recommend')
  async recommend(@Body() body: Record<string, any>) {
    await this.service.setDocumentRecommend(
      this.numArray(body.id),
      Number(body.type) || 0,
    );
    return {};
  }

  @RequirePermission('/api.v1.DocumentAPI/CheckDocument')
  @Put('check')
  async check(@Body() body: Record<string, any>) {
    await this.service.checkDocument(
      this.numArray(body.id),
      Number(body.status),
    );
    return {};
  }

  @RequirePermission('/api.v1.DocumentAPI/SetDocumentReconvert')
  @Put('reconvert')
  async reconvert() {
    await this.service.setDocumentReconvert();
    return {};
  }

  @RequirePermission('/api.v1.DocumentAPI/SetDocumentsCategory')
  @Put('category')
  async setCategory(@Body() body: Record<string, any>) {
    await this.service.setDocumentsCategory(
      this.numArray(body.document_id),
      this.numArray(body.category_id),
    );
    return {};
  }

  @RequirePermission('/api.v1.DocumentAPI/SetDocumentsLanguage')
  @Put('language')
  async setLanguage(@Body() body: Record<string, any>) {
    await this.service.setDocumentsLanguage(
      this.numArray(body.document_id),
      String(body.language ?? ''),
    );
    return {};
  }

  @RequirePermission('/api.v1.DocumentAPI/DownloadDocumentToBeReviewed')
  @Get('download/bereviewed')
  downloadToBeReviewed(
    @Query('id') id: unknown,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.service.downloadDocumentToBeReviewed(
      this.numArray(id)[0] || 0,
      this.userIdOf(user),
      ip || '',
    );
  }

  // ---------- 回收站 ----------

  @RequirePermission('/api.v1.RecycleAPI/ListRecycleDocument')
  @Get('recycle')
  recycleList(@Query() query: Record<string, any>) {
    return this.service.listRecycleDocument(query);
  }

  @RequirePermission('/api.v1.RecycleAPI/RecoverRecycleDocument')
  @Put('recycle')
  async recoverRecycle(@Body() body: Record<string, any>) {
    await this.service.recoverRecycleDocument(this.numArray(body.id));
    return {};
  }

  @RequirePermission('/api.v1.RecycleAPI/DeleteRecycleDocument')
  @Delete('recycle')
  async deleteRecycle(@Query('id') id: unknown) {
    await this.service.deleteRecycleDocument(this.numArray(id));
    return {};
  }

  @RequirePermission('/api.v1.RecycleAPI/ClearRecycleDocument')
  @Delete('recycle/all')
  async clearRecycle() {
    await this.service.clearRecycleDocument();
    return {};
  }
}