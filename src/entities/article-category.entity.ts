import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('article_category')
export class ArticleCategory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_article_id')
  @Index('idx_article_category', { unique: true })
  @Column({ type: 'int', default: 0 })
  article_id: number;

  @Index('idx_category_id')
  @Index('idx_article_category', { unique: true })
  @Column({ type: 'int', default: 0 })
  category_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}