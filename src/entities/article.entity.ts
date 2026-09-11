import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('article')
export class Article {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('identifier', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  identifier: string;

  @Index('user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'int', default: 0 })
  view_count: number;

  @Column({ type: 'int', default: 0 })
  favorite_count: number;

  @Column({ type: 'int', default: 0 })
  comment_count: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  keywords: string;

  @Column({ type: 'varchar', length: 1024, default: '' })
  description: string;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Index('idx_deleted_at')
  @Column({ type: 'datetime', nullable: true })
  deleted_at: Date | null;

  @Index('idx_recommend_at')
  @Column({ type: 'datetime', nullable: true })
  recommend_at: Date | null;

  @Index('idx_status')
  @Column({ type: 'int', default: 0 })
  status: number;

  @Column({ type: 'tinyint', default: 0 })
  is_notice: number;

  @Column({ type: 'varchar', length: 2048, default: '' })
  reject_reason: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  source: string;

  @Column({ type: 'varchar', length: 1024, default: '' })
  source_url: string;
}