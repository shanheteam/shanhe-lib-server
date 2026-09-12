import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 文章采集：嗅探发现的文章详情
 * 对应专业版 spider_article_detail 表
 */
@Entity('spider_article_detail')
export class SpiderArticleDetail {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  // 来源 spider_article_list.id
  @Index()
  @Column({ type: 'bigint', default: 0 })
  article_list_id: number;

  // 0待采集 1采集队列 2采集中 3采集成功 4采集失败
  // 5发布队列 6发布中 7发布成功 8发布失败
  @Index()
  @Column({ type: 'int', default: 0 })
  status: number;

  @Column({ type: 'varchar', length: 500, default: '' })
  title: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  source: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  keywords: string;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ type: 'text' })
  content_title_rules: string;

  @Column({ type: 'text' })
  content_rules: string;

  @Column({ type: 'text' })
  content_exclude_rules: string;

  @Column({ type: 'text' })
  content_replace_rules: string;

  @Column({ type: 'boolean', default: false })
  enable_browser: boolean;

  @Column({ type: 'datetime', nullable: true })
  published_at: Date | null;

  // 发布后生成的正式文章 ID
  @Index()
  @Column({ type: 'bigint', default: 0 })
  article_id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  // 发布目标分类，存级联路径 JSON 字符串，如 "[1,12]"
  @Column({ type: 'varchar', length: 255, default: '' })
  category_id: string;

  @Column({ type: 'text' })
  error: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
