import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// download 随访问量线性增长，是最大的表之一。下载前的每日次数校验固定发这三类查询，
// 只有单列索引时每类都只能用一半条件命中、另一半靠回表逐行过滤，故补复合索引：
//   1) count({ ip, created_at >= 今日 })                        → (ip, created_at)
//   2) count({ user_id, created_at >= 今日 })                    → (user_id, created_at)
//   3) findOne({ user_id, document_id, is_pay, created_at >= x }) → (user_id, document_id, is_pay)
@Entity('download')
@Index('idx_user_created', ['user_id', 'created_at'])
@Index('idx_ip_created', ['ip', 'created_at'])
@Index('idx_user_document_pay', ['user_id', 'document_id', 'is_pay'])
export class Download {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index('idx_document_id')
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Index('idx_ip')
  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Column({ type: 'boolean', default: false })
  is_pay: boolean;

  @Index('idx_created_at')
  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}