import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';
import { JwtUser } from '../../auth/jwt-user.type';
import { UserService } from './user.service';
import { toNumberArray } from '../../common/query.util';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}



  @RequireLogin()
  @Delete('logout')
  logout(@CurrentUser() user: JwtUser) {
    return this.userService.logout(user);
  }

  @Public()
  @Get()
  getUser(@Query('id') id: any, @CurrentUser() user: JwtUser | undefined) {
    return this.userService.getUser(id === undefined ? undefined : Number(id), user);
  }


  @RequireLogin()
  @Put('profile')
  updateUserProfile(@Body() body: any, @CurrentUser() user: JwtUser) {
    return this.userService.updateUserProfile(body, user);
  }

  @RequirePermission('/api.v1.UserAPI/DeleteUser')
  @Delete()
  deleteUser(@Query() query: any, @CurrentUser() user: JwtUser) {
    return this.userService.deleteUser(
      {
        id: toNumberArray(query?.id),
        password: query?.password,
      },
      user,
    );
  }

  @RequirePermission('/api.v1.UserAPI/AddUser')
  @Post()
  addUser(@Body() body: any, @CurrentUser() user: JwtUser) {
    return this.userService.addUser(body, user);
  }

  @RequirePermission('/api.v1.UserAPI/SetUser')
  @Put()
  setUser(@Body() body: any, @CurrentUser() user: JwtUser) {
    return this.userService.setUser(body, user);
  }

  @RequirePermission('/api.v1.UserAPI/ListUser')
  @Get('list')
  listUser(@Query() query: any) {
    return this.userService.listUser(query);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @Get('captcha')
  getUserCaptcha(@Query('type') type: string) {
    return this.userService.getUserCaptcha(type);
  }

  @RequireLogin()
  @Get('permission')
  getUserPermissions(@CurrentUser() user: JwtUser) {
    return this.userService.getUserPermissions(user);
  }

  @RequireLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Get('caniuploaddocument')
  canIUploadDocument(@CurrentUser() user: JwtUser) {
    return this.userService.canIUploadDocument(user);
  }

  @RequireLogin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Get('canipublisharticle')
  canIPublishArticle(@CurrentUser() user: JwtUser) {
    return this.userService.canIPublishArticle(user);
  }

  @RequireLogin()
  @Get('dynamic')
  listUserDynamic(@Query('page') page: any, @Query('size') size: any, @CurrentUser() user: JwtUser) {
    return this.userService.listUserDynamic(user, Number(page) || 1, Number(size) || 10);
  }

  @RequireLogin()
  @Put('sign')
  signToday(@CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.userService.signToday(user, ip);
  }

  @RequireLogin()
  @Get('sign')
  getSignedToday(@CurrentUser() user: JwtUser) {
    return this.userService.getSignedToday(user);
  }

  @RequireLogin()
  @Get('download')
  listUserDownload(@Query('page') page: any, @Query('size') size: any, @CurrentUser() user: JwtUser) {
    return this.userService.listUserDownload(user, Number(page) || 1, Number(size) || 10);
  }

  @RequireLogin()
  @Get('group')
  listUserGroup(@CurrentUser() user: JwtUser) {
    return this.userService.listUserGroup(user);
  }



}