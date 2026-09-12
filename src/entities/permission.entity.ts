import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('permission')
@Index('method_path', ['method', 'path'], { unique: true })
@Index('idx_method', ['method'])
export class Permission {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 16 })
  method: string;

  @Column({ type: 'varchar', length: 128 })
  path: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}