import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('category')
export class Category {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  icon: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  cover: string;

  @Index('parent_id')
  @Column({ type: 'int', default: 0 })
  parent_id: number;

  @Column({ type: 'varchar', length: 64 })
  title: string;

  @Column({ type: 'int', default: 0 })
  doc_count: number;

  @Index('idx_type')
  @Column({ type: 'tinyint', default: 0 })
  type: number;

  @Index('idx_sort')
  @Column({ type: 'int', default: 0 })
  sort: number;

  @Index('idx_enable')
  @Column({ type: 'boolean', default: true })
  enable: boolean;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'boolean', default: false })
  show_description: boolean;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}