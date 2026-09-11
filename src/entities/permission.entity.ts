import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('permission')
export class Permission {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('method_path', { unique: true })
  @Index('idx_method')
  @Column({ type: 'varchar', length: 16 })
  method: string;

  @Index('method_path', { unique: true })
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