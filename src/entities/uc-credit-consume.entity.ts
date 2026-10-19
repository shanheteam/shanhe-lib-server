import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * user-center 侧消费 lib 金币的流水表（兼幂等表）。
 *
 * user-center 发起消费时带唯一 request_id 调用 lib 的
 * POST /api/v1/oauth/credit/consume；lib 先原子条件扣减 user.credit_count，
 * 再把本次消费写入本表。request_id 唯一索引保证重复提交（重试/双击）只扣一次。
 *
 * 建表：npm run sync:db（等价 AutoMigrate），或执行 sql/uc-credit-consume.sql。
 */
@Entity('uc_credit_consume')
export class UcCreditConsume {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_uc_credit_consume_user_id')
  @Column({ type: 'bigint' })
  user_id: number;

  /** user-center 用户标识（token 的 sub/openid），便于跨系统对账 */
  @Column({ type: 'varchar', length: 128, default: '' })
  uc_sub: string;

  @Index('idx_uc_credit_consume_request_id', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  request_id: string;

  /** 扣减额（正整数） */
  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  reason: string;

  /** 扣减后余额，幂等命中时原样回放 */
  @Column({ type: 'int', default: 0 })
  balance_after: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;
}
