import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('group_permission')
export class GroupPermission {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('group_permission', { unique: true })
  @Index('group_id')
  @Column({ type: 'bigint' })
  group_id: number;

  @Index('group_permission', { unique: true })
  @Column({ type: 'bigint' })
  permission_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}