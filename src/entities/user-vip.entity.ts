import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 用户 VIP 会员关系（专业版）
 * 一个用户可存在多条（可叠加），生效优先级：年卡(0) > 季卡(1) > 月卡(2)
 */
@Entity('user_vip')
export class UserVip {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  // 0年卡 1季卡 2月卡
  @Index()
  @Column({ type: 'int', default: 0 })
  type: number;

  // 文档购买折扣快照（十分之一折，如 90 = 9 折）
  @Column({ type: 'int', default: 100 })
  discount: number;

  // 周期内 VIP 文档免费下载总配额
  @Column({ type: 'int', default: 0 })
  download: number;

  // 已消耗的专享下载次数
  @Column({ type: 'int', default: 0 })
  download_used: number;

  // 每日下载频次，0=不限
  @Column({ type: 'int', default: 0 })
  times: number;

  @Column({ type: 'datetime', nullable: true })
  joined_at: Date | null;

  @Index()
  @Column({ type: 'datetime', nullable: true })
  expired_at: Date | null;

  @Column({ type: 'varchar', length: 64, default: '' })
  order_no: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
