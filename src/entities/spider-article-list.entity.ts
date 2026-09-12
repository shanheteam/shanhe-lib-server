import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 文章嗅探：文章列表页来源（接口路径段 source）
 * 对应专业版 spider_article_list 表
 */
@Entity('spider_article_list')
export class SpiderArticleList {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'text' })
  url: string;

  // 0待嗅探 1嗅探中 2嗅探完成 3嗅探失败
  @Index()
  @Column({ type: 'int', default: 0 })
  status: number;

  // 发现文章数（后端统计）
  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'boolean', default: false })
  enable_browser: boolean;

  // 嗅探频率（天）
  @Column({ type: 'int', default: 0 })
  frequency: number;

  // 列表条目选择器（HTML selector，每行一个）
  @Column({ type: 'text' })
  list_rules: string;

  // 文章标题选择器
  @Column({ type: 'text' })
  content_title_rules: string;

  // 正文选择器
  @Column({ type: 'text' })
  content_rules: string;

  // 正文排除选择器
  @Column({ type: 'text' })
  content_exclude_rules: string;

  // 内容替换规则，每行：原字符 => 新字符
  @Column({ type: 'text' })
  content_replace_rules: string;

  @Column({ type: 'text' })
  error: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
