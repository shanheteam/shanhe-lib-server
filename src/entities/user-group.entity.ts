import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_group')
@Index('user_group', ['user_id', 'group_id'], { unique: true })
@Index('user_id', ['user_id'])
// 后台「按用户组筛选用户」用 where group_id IN (...)：
// (user_id, group_id) 与 user_id 两个索引都以 user_id 为最左前缀，group_id 用不上，会全表扫描。
@Index('idx_group_id', ['group_id'])
export class UserGroup {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'bigint', default: 0 })
  group_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}