import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Order, Document, User, UserVip } from '../../entities';
import { ConfigService } from '../../config/config.service';
import { Biz } from '../../common/biz.exception';
import {
  normalizePageSize,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';

export const ORDER_STATUS = {
  PENDING: 1, // 待支付
  PAID: 2, // 已支付
  CLOSED: 3, // 已关闭
} as const;

export const ORDER_TYPE = {
  DOCUMENT: 1, // 购买文档
  VIP: 2, // 购买VIP
  RECHARGE: 3, // 账户充值
} as const;

const VIP_PREFIX = ['year', 'quarter', 'month'];
const VIP_DAYS = [365, 90, 30];

@Injectable()
export class OrderService implements OnModuleInit {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserVip)
    private readonly vipRepo: Repository<UserVip>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // 每分钟扫描一次超时未支付订单并关闭
    setInterval(() => {
      this.closeExpired().catch((e) => this.logger.error(`关单异常：${(e as Error).message}`));
    }, 60_000);
  }

  // ---------- 查询 ----------

  async list(query: any): Promise<{ total: number; order: any[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoin(User, 'u', 'u.id = o.user_id')
      .select([
        'o.*',
        'u.realname AS realname',
        'u.mobile AS mobile',
        'u.avatar AS avatar',
      ]);

    const statuses = toNumberArray(query.order_status ?? query.status);
    if (statuses.length) qb.andWhere('o.status IN (:...statuses)', { statuses });
    const types = toNumberArray(query.order_type);
    if (types.length) qb.andWhere('o.order_type IN (:...types)', { types });
    const payments = toNumberArray(query.payment_type);
    if (payments.length) qb.andWhere('o.payment_type IN (:...payments)', { payments });
    const userIds = toNumberArray(query.user_id);
    if (userIds.length) qb.andWhere('o.user_id IN (:...userIds)', { userIds });
    const orderNo = toStringValue(query.order_no || query.wd);
    if (orderNo) {
      qb.andWhere('(o.order_no LIKE :orderNo OR o.product_name LIKE :orderNo)', {
        orderNo: `%${orderNo}%`,
      });
    }

    qb.orderBy('o.id', 'DESC')
      .skip((page - 1) * size)
      .take(size);

    const [rows, total] = await Promise.all([qb.getRawMany(), qb.getCount()]);
    return { total, order: rows };
  }

  async getByNo(orderNo: string): Promise<Order | null> {
    return this.orderRepo.findOne({ where: { order_no: orderNo } });
  }

  async get(id: number): Promise<Order> {
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw Biz.notFound('订单不存在');
    return order;
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择订单');
    await this.orderRepo.delete(ids);
  }

  // ---------- 下单 ----------

  async create(userId: number, body: any): Promise<Order> {
    if (userId <= 0) throw Biz.unauthenticated('请先登录');
    const user = await this.userRepo.findOne({ where: { id: userId }, select: { id: true } });
    if (!user) throw Biz.notFound('用户不存在');

    const orderType = Number(body.order_type);
    const quantity = Math.max(1, Number(body.quantity) || 1);
    const now = new Date();

    let productId = 0;
    let productName = '';
    let productUuid = '';
    let priceFen = 0; // 单价（分）
    let amountFen = 0; // 实付（分）

    if (orderType === ORDER_TYPE.RECHARGE) {
      const creditsPerUnit = Number(body.product_id || body.amount);
      if (!Number.isInteger(creditsPerUnit) || creditsPerUnit <= 0) throw Biz.invalidArgument('充值积分数不正确');
      productId = creditsPerUnit * quantity;
      productName = `账户充值 ${productId} 积分`;
      priceFen = this.creditsToFen(creditsPerUnit);
      amountFen = priceFen * quantity;
    } else if (orderType === ORDER_TYPE.VIP) {
      const vipType = Number(body.product_id);
      if (![0, 1, 2].includes(vipType)) throw Biz.invalidArgument('VIP类型不正确');
      if (!this.config.getBool('vip', 'enable', false)) throw Biz.invalidArgument('VIP功能未开启');
      productId = vipType;
      const prefix = VIP_PREFIX[vipType];
      priceFen = this.config.getInt('vip', `${prefix}_price`, 0);
      if (priceFen <= 0) throw Biz.invalidArgument('该VIP套餐尚未配置价格');
      amountFen = priceFen;
      productName = ['年卡会员', '季卡会员', '月卡会员'][vipType];
    } else if (orderType === ORDER_TYPE.DOCUMENT) {
      const docId = Number(body.product_id);
      const doc = await this.docRepo.findOne({ where: { id: docId, deleted_at: IsNull() } });
      if (!doc) throw Biz.notFound('文档不存在');
      productId = docId;
      productUuid = doc.uuid;
      productName = doc.title;
      priceFen = this.creditsToFen(doc.price);
      amountFen = priceFen;
    } else {
      throw Biz.invalidArgument('订单类型不正确');
    }

    const order = await this.orderRepo.save(this.orderRepo.create({
      order_no: this.genOrderNo(),
      status: ORDER_STATUS.PENDING,
      order_type: orderType,
      product_id: productId,
      product_uuid: productUuid,
      product_name: productName.slice(0, 500),
      user_id: userId,
      quantity,
      price: priceFen,
      coupon_amount: 0,
      amount: amountFen,
      payment_type: 0,
      remark: '',
      paid_at: null,
      closed_at: new Date(now.getTime() + this.getCloseMinutes() * 60_000),
      created_at: now,
      updated_at: now,
    }));
    return order;
  }

  /** 发起支付（骨架：校验渠道配置；真实第三方下单待接入对应 SDK） */
  async pay(userId: number, body: any): Promise<void> {
    const orderNo = String(body.order_no ?? '');
    const paymentType = Number(body.payment_type);
    const order = await this.orderRepo.findOne({ where: { order_no: orderNo } });
    if (!order || Number(order.user_id) !== userId) throw Biz.notFound('订单不存在');
    if (order.status === ORDER_STATUS.PAID) throw Biz.alreadyExists('订单已支付');
    if (order.status === ORDER_STATUS.CLOSED) throw Biz.invalidArgument('订单已关闭');
    if (![1, 2, 8].includes(paymentType)) throw Biz.invalidArgument('支付方式不正确');

    const category = paymentType === 1 ? 'wechatpay' : paymentType === 2 ? 'alipay' : 'xunhupay';
    if (!this.config.getBool(category, `enable_${category}`, false)) {
      throw Biz.internal('该支付方式未启用，请在后台【支付配置】中开启并填写参数');
    }
    throw Biz.internal('在线支付渠道尚未完成对接，请先使用后台【系统充值】');
  }

  // ---------- 关单 ----------

  async close(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('请选择订单');
    await this.orderRepo.update(
      { id: In(ids), status: ORDER_STATUS.PENDING },
      { status: ORDER_STATUS.CLOSED, closed_at: new Date(), updated_at: new Date() },
    );
  }

  async closeExpired(): Promise<void> {
    await this.orderRepo
      .createQueryBuilder()
      .update(Order)
      .set({ status: ORDER_STATUS.CLOSED, closed_at: () => 'NOW()', updated_at: () => 'NOW()' })
      .where('status = :pending', { pending: ORDER_STATUS.PENDING })
      .andWhere('closed_at IS NOT NULL AND closed_at < NOW()')
      .execute();
  }

  // ---------- 系统充值 ----------

  async systemRecharge(operatorId: number, body: any): Promise<Order> {
    const userId = Number(body.user_id);
    const amount = Number(body.amount);
    if (!Number.isInteger(userId) || userId <= 0) throw Biz.invalidArgument('用户ID不正确');
    if (!Number.isInteger(amount) || amount === 0) throw Biz.invalidArgument('充值积分数量不正确（正数为充值，负数为扣减）');
    const user = await this.userRepo.findOne({ where: { id: userId }, select: { id: true, credit_count: true } });
    if (!user) throw Biz.notFound('用户不存在');
    if (amount < 0 && Number(user.credit_count) + amount < 0) {
      throw Biz.invalidArgument('扣减后积分不能为负');
    }

    const now = new Date();
    const order = await this.orderRepo.manager.transaction(async (manager) => {
      const row = await manager.save(Order, manager.create(Order, {
        order_no: this.genOrderNo(),
        status: ORDER_STATUS.PAID,
        order_type: ORDER_TYPE.RECHARGE,
        product_id: amount,
        product_name: amount > 0 ? '系统充值' : '系统扣减',
        user_id: userId,
        quantity: 1,
        price: amount,
        coupon_amount: 0,
        amount: amount,
        payment_type: 6, // 系统充值
        trade_no: `SYS-${operatorId}-${now.getTime()}`,
        remark: String(body.remark ?? '').slice(0, 500),
        paid_at: now,
        closed_at: null,
        created_at: now,
        updated_at: now,
      }));
      await manager.increment(User, { id: userId }, 'credit_count', amount);
      return row;
    });
    return order;
  }

  // ---------- 支付成功回调后的履约（供未来支付 SDK 接入调用） ----------

  async markPaid(orderNo: string, tradeNo: string, paymentType: number): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { order_no: orderNo } });
    if (!order) throw Biz.notFound('订单不存在');
    if (order.status === ORDER_STATUS.PAID) return;
    if (order.status === ORDER_STATUS.CLOSED) throw Biz.invalidArgument('订单已关闭');
    await this.orderRepo.update(order.id, {
      status: ORDER_STATUS.PAID,
      trade_no: String(tradeNo).slice(0, 128),
      payment_type: paymentType,
      paid_at: new Date(),
      updated_at: new Date(),
    });
    await this.fulfill({ ...order, status: ORDER_STATUS.PAID, trade_no: String(tradeNo), payment_type: paymentType });
  }

  private async fulfill(order: Order): Promise<void> {
    if (order.order_type === ORDER_TYPE.RECHARGE) {
      await this.userRepo.increment({ id: Number(order.user_id) }, 'credit_count', Number(order.product_id));
    } else if (order.order_type === ORDER_TYPE.VIP) {
      await this.grantVip(Number(order.user_id), Number(order.product_id));
    }
    // 文档购买（类型1）的权益发放由下载鉴权流程处理
  }

  private async grantVip(userId: number, vipType: number): Promise<void> {
    const prefix = VIP_PREFIX[vipType];
    const now = new Date();
    // 在既有最长到期时间上顺延
    const last = await this.vipRepo.findOne({
      where: { user_id: userId },
      order: { expired_at: 'DESC' },
    });
    const base = last?.expired_at && last.expired_at > now ? last.expired_at : now;
    const expiredAt = new Date(base.getTime() + VIP_DAYS[vipType] * 86400_000);
    await this.vipRepo.save(this.vipRepo.create({
      user_id: userId,
      type: vipType,
      discount: this.config.getInt('vip', `${prefix}_document_discount`, 100),
      download: this.config.getInt('vip', `${prefix}_download`, 0),
      download_used: 0,
      times: this.config.getInt('vip', `${prefix}_times_every_day`, 0),
      joined_at: now,
      expired_at: expiredAt,
      order_no: '',
      created_at: now,
      updated_at: now,
    }));
  }

  // ---------- 工具 ----------

  private creditsToFen(credits: number): number {
    const exchange = Math.max(1, this.config.getInt('score', 'credit_exchange', 10));
    // 1 元 = exchange 积分；1 元 = 100 分
    return Math.round((credits / exchange) * 100);
  }

  private getCloseMinutes(): number {
    return Math.max(1, this.config.getInt('security', 'order_close_minutes', 30));
  }

  private genOrderNo(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `M${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}${String(d.getMilliseconds()).padStart(3, '0')}`;
  }
}
