import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 文档采集：嗅探发现的附件文档
 * 对应专业版 spider_document 表
 */
@Entity('spider_document')
export class SpiderDocument {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  // 0待下载 1下载队列 2下载中 3下载成功 4下载失败
  // 5发布队列 6发布中 7发布成功 8发布失败
  @Index()
  @Column({ type: 'int', default: 0 })
  status: number;

  @Column({ type: 'text' })
  url: string;

  // 语言 code（如 zh-CN）
  @Column({ type: 'varchar', length: 32, default: '' })
  language: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  title: string;

  // 链接 <a> 文本推断的标题
  @Column({ type: 'varchar', length: 500, default: '' })
  title_from_href: string;

  // URL 推断的标题
  @Column({ type: 'varchar', length: 500, default: '' })
  title_from_url: string;

  // 附件名推断的标题
  @Column({ type: 'varchar', length: 500, default: '' })
  title_from_attachment: string;

  // 文档价格（积分）
  @Column({ type: 'int', default: 0 })
  price: number;

  // 文件大小（字节）
  @Column({ type: 'bigint', default: 0 })
  size: number;

  @Column({ type: 'varchar', length: 32, default: '' })
  ext: string;

  @Column({ type: 'varchar', length: 128, default: '' })
  content_type: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  save_path: string;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  // 发布分类，存级联路径 JSON 字符串
  @Column({ type: 'varchar', length: 255, default: '' })
  category_id: string;

  // 发布后的正式文档 ID
  @Index()
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Column({ type: 'text' })
  error: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
