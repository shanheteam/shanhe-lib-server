import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppThrottlerGuard } from './common/throttler.guard';
import { dataSourceOptions } from './database/data-source';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ConverterModule } from './modules/converter/converter.module';
import { CaptchaModule } from './modules/captcha/captcha.module';
import { HealthModule } from './modules/health/health.module';
import { UserModule } from './modules/user/user.module';
import { ConfigApiModule } from './modules/config/config.module';
import { GroupModule } from './modules/group/group.module';
import { PermissionModule } from './modules/permission/permission.module';
import { CategoryModule } from './modules/category/category.module';
import { ArticleModule } from './modules/article/article.module';
import { DocumentModule } from './modules/document/document.module';
import { AttachmentModule } from './modules/attachment/attachment.module';
import { CommentModule } from './modules/comment/comment.module';
import { FavoriteModule } from './modules/favorite/favorite.module';
import { BannerModule } from './modules/banner/banner.module';
import { AdvertisementModule } from './modules/advertisement/advertisement.module';
import { FriendlinkModule } from './modules/friendlink/friendlink.module';
import { NavigationModule } from './modules/navigation/navigation.module';
import { LanguageModule } from './modules/language/language.module';
import { ReportModule } from './modules/report/report.module';
import { PunishmentModule } from './modules/punishment/punishment.module';
import { SearchRecordModule } from './modules/searchrecord/searchrecord.module';
import { DownloadModule } from './modules/download/download.module';
import { DynamicModule } from './modules/dynamic/dynamic.module';
import { SearchModule } from './modules/search/search.module';
import { SpiderModule } from './modules/spider/spider.module';
import { OrderModule } from './modules/order/order.module';
import { SmsModule } from './modules/sms/sms.module';
import { UserVipModule } from './modules/uservip/uservip.module';
import { PayConfigModule } from './modules/payconfig/payconfig.module';
import { OauthModule } from './modules/oauth/oauth.module';

@Module({
  imports: [
    // 全局限流：默认每 IP 每分钟 600 次；登录、注册等敏感接口按路由单独收紧
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    TypeOrmModule.forRoot(dataSourceOptions),
    AuthModule,
    ConfigModule,
    ConverterModule,
    CaptchaModule,
    HealthModule,
    UserModule,
    ConfigApiModule,
    GroupModule,
    PermissionModule,
    CategoryModule,
    ArticleModule,
    DocumentModule,
    AttachmentModule,
    CommentModule,
    FavoriteModule,
    BannerModule,
    AdvertisementModule,
    FriendlinkModule,
    NavigationModule,
    LanguageModule,
    ReportModule,
    PunishmentModule,
    SearchRecordModule,
    DownloadModule,
    DynamicModule,
    SearchModule,
    SpiderModule,
    OrderModule,
    SmsModule,
    UserVipModule,
    PayConfigModule,
    OauthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}