import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('article_relate')
export class ArticleRelate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_article_id', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  article_id: number;

  @Column({ type: 'text' })
  related_article_id: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}