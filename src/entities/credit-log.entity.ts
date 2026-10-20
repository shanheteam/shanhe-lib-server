import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** 积分流水类型 */
export enum CreditLogType {
  Register = 1, // 注册奖励
  SignIn = 2, // 每日签到
  UploadDocument = 3, // 上传文档奖励
  DeleteDocument = 4, // 删除文档扣分
  DocumentCollected = 5, // 文档被收藏奖励
  DocumentCommented = 6, // 文档被评论奖励
}

/**
 * 积分流水：奖励与扣减均落库，
 * 用于每日次数上限统计、对账与审计。
 */
@Entity('credit_log')
@Index('idx_credit_log_user_type_created', ['user_id', 'type', 'created_at'])
export class CreditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'smallint', default: 0 })
  type: number;

  /** 正数为获得，负数为扣除 */
  @Column({ type: 'int', default: 0 })
  amount: number;

  /** 变动后的积分余额 */
  @Column({ type: 'int', default: 0 })
  balance_after: number;

  /** 关联业务记录 ID（文档 ID、评论 ID 等） */
  @Column({ type: 'bigint', default: 0 })
  ref_id: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  remark: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;
}
