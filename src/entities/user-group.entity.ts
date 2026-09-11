import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_group')
export class UserGroup {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('user_group', { unique: true })
  @Index('user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index('user_group', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  group_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}