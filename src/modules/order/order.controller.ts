import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { RequireLogin } from '../../common/decorators/require-login.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtUser } from '../../auth/jwt-user.type';
import { toNumberArray } from '../../common/query.util';
import { OrderService } from './order.service';

@Controller('order')
export class OrderController {
  constructor(private readonly service: OrderService) {}

  @Get('list')
  @RequirePermission('/api.v1.OrderAPI/ListOrder')
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Get('status')
  @RequireLogin()
  async status(@CurrentUser() user: JwtUser, @Query('order_no') orderNo: string) {
    const order = await this.service.getByNo(String(orderNo ?? ''));
    if (!order || Number(order.user_id) !== user.userId) {
      return { status: 0 };
    }
    return { status: order.status, order_no: order.order_no };
  }

  @Get()
  @RequirePermission('/api.v1.OrderAPI/GetOrder')
  get(@Query('id') id: string) {
    return this.service.get(Number(id));
  }

  @Post()
  @RequireLogin()
  create(@CurrentUser() user: JwtUser, @Body() body: any) {
    return this.service.create(user.userId, body);
  }

  /** 账户积分充值下单（前端用户） */
  @Post('recharge')
  @RequireLogin()
  recharge(@CurrentUser() user: JwtUser, @Body() body: any) {
    return this.service.create(user.userId, { ...body, order_type: 3 });
  }

  @Post('pay')
  @RequireLogin()
  pay(@CurrentUser() user: JwtUser, @Body() body: any) {
    return this.service.pay(user.userId, body);
  }

  @Put('close')
  @RequirePermission('/api.v1.OrderAPI/CloseOrder')
  close(@Body() body: { id?: unknown }) {
    return this.service.close(toNumberArray(body?.id));
  }

  @Delete()
  @RequirePermission('/api.v1.OrderAPI/DeleteOrder')
  remove(@Query('id') id: unknown) {
    return this.service.remove(toNumberArray(id));
  }

  @Post('system/recharge')
  @RequirePermission('/api.v1.OrderAPI/SystemRecharge')
  systemRecharge(@CurrentUser() user: JwtUser, @Body() body: any) {
    return this.service.systemRecharge(user.userId, body);
  }
}
