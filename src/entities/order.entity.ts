import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 订单（专业版支付/充值/VIP）
 * 金额单位：积分（人民币元 = price / credit_exchange）
 */
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  // 业务订单号
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  order_no: string;

  // 1待支付 2已支付 3已关闭
  @Index()
  @Column({ type: 'int', default: 1 })
  status: number;

  // 1购买文档 2购买VIP 3账户充值 4提现
  @Index()
  @Column({ type: 'int', default: 1 })
  order_type: number;

  // 类型1=文档ID；类型2=VIP类型(0年/1季/2月)；类型3=充值积分数
  @Column({ type: 'bigint', default: 0 })
  product_id: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  product_uuid: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  product_name: string;

  @Index()
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  // 商品单价（积分）
  @Column({ type: 'bigint', default: 0 })
  price: number;

  // 优惠金额（积分）
  @Column({ type: 'bigint', default: 0 })
  coupon_amount: number;

  // 实付金额（积分）
  @Column({ type: 'bigint', default: 0 })
  amount: number;

  // 1微信 2支付宝 3银行卡 4现金 5积分 6系统充值 7其他 8虎皮椒 9下载码 10广告
  @Column({ type: 'int', default: 0 })
  payment_type: number;

  // 第三方支付流水号
  @Column({ type: 'varchar', length: 128, default: '' })
  trade_no: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  remark: string;

  @Column({ type: 'datetime', nullable: true })
  paid_at: Date | null;

  // 下单时预写为应关闭时刻，关闭后作为关闭时间
  @Column({ type: 'datetime', nullable: true })
  closed_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
