import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('group_permission')
@Index('group_permission', ['group_id', 'permission_id'], { unique: true })
@Index('group_id', ['group_id'])
export class GroupPermission {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint' })
  group_id: number;

  @Column({ type: 'bigint' })
  permission_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}