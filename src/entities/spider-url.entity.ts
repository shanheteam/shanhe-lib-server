import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 文档嗅探：采集源链接
 * 对应专业版 spider_url 表
 */
@Entity('spider_url')
export class SpiderUrl {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'text' })
  url: string;

  // 0待嗅探 1嗅探中 2嗅探完成 3嗅探失败
  @Index()
  @Column({ type: 'int', default: 0 })
  status: number;

  // 发现文档数（后端统计）
  @Column({ type: 'int', default: 0 })
  total: number;

  // 是否启用浏览器渲染（针对 JS 渲染页面）
  @Column({ type: 'boolean', default: false })
  enable_browser: boolean;

  // 嗅探频率（天）
  @Column({ type: 'int', default: 0 })
  frequency: number;

  // 嗅探层级，0 表示种子链接
  @Column({ type: 'int', default: 0 })
  level: number;

  // 链接前缀（多行并集）
  @Column({ type: 'text' })
  url_prefix: string;

  // URL 必须包含的关键字（多行）
  @Column({ type: 'text' })
  include_url_keywords: string;

  // URL 排除关键字（多行）
  @Column({ type: 'text' })
  exclude_url_keywords: string;

  @Column({ type: 'text' })
  error: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
