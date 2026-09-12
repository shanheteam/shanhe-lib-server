import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('article_category')
@Index('idx_article_category', ['article_id', 'category_id'], { unique: true })
@Index('idx_article_id', ['article_id'])
@Index('idx_category_id', ['category_id'])
export class ArticleCategory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'int', default: 0 })
  article_id: number;

  @Column({ type: 'int', default: 0 })
  category_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}