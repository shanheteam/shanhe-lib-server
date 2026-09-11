import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('group')
export class Group {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('title', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  title: string;

  @Column({ type: 'varchar', length: 20, default: '' })
  color: string;

  @Index('is_default')
  @Column({ type: 'boolean', default: false })
  is_default: boolean;

  @Column({ type: 'boolean', default: false })
  is_display: boolean;

  @Column({ type: 'varchar', length: 255, default: '' })
  description: string;

  @Column({ type: 'int', default: 0 })
  user_count: number;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'boolean', default: false })
  enable_upload: boolean;

  @Column({ type: 'boolean', default: false })
  enable_document_review: boolean;

  @Column({ type: 'boolean', default: true })
  enable_comment: boolean;

  @Column({ type: 'boolean', default: false })
  enable_comment_approval: boolean;

  @Column({ type: 'boolean', default: true })
  enable_article: boolean;

  @Column({ type: 'boolean', default: false })
  enable_article_approval: boolean;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}