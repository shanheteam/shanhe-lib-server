import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_group')
@Index('user_group', ['user_id', 'group_id'], { unique: true })
@Index('user_id', ['user_id'])
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