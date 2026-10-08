import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('document')
export class Document {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  keywords: string;

  @Column({ type: 'varchar', length: 1024, default: '' })
  description: string;

  @Index('user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'int', default: 0 })
  width: number;

  @Column({ type: 'int', default: 0 })
  height: number;

  @Column({ type: 'int', default: 0 })
  preview: number;

  @Index('idx_pages')
  @Column({ type: 'int', default: 0 })
  pages: number;

  @Index('idx_download_count')
  @Column({ type: 'int', default: 0 })
  download_count: number;

  @Index('idx_view_count')
  @Column({ type: 'int', default: 0 })
  view_count: number;

  @Index('idx_favorite_count')
  @Column({ type: 'int', default: 0 })
  favorite_count: number;

  // 前端公开排序选项（views/category/_id.vue 的「评论最多」→ ?order=comment_count desc）；
  // 无索引时该排序会全表扫描 + filesort，且 getManyAndCount 会再扫一遍
  @Index('idx_comment_count')
  @Column({ type: 'int', default: 0 })
  comment_count: number;

  @Column({ type: 'int', default: 300 })
  score: number;

  @Column({ type: 'int', default: 0 })
  score_count: number;

  @Index('idx_price')
  @Column({ type: 'int', default: 0 })
  price: number;

  @Column({ type: 'bigint', default: 0 })
  size: number;

  @Index('idx_ext')
  @Column({ type: 'varchar', length: 16, default: '' })
  ext: string;

  // 复合索引：转换 worker 的「按 status 取 id 最小的一条」查询依赖它直接定位有序首行。
  // 仅有单列 status 索引时，`status IN (0,5) ORDER BY id LIMIT 1` 在队列为空时会退化为
  // 沿主键逐行过滤（每 5 秒一次全表级扫描）。(status, id) 也可作为 status 等值查询的前缀索引。
  @Index('idx_status_id', ['status', 'id'])
  @Index('status')
  @Column({ type: 'smallint', default: 0 })
  status: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Index('idx_deleted_at')
  @Column({ type: 'datetime', nullable: true })
  deleted_at: Date | null;

  @Column({ type: 'bigint', default: 0 })
  deleted_user_id: number;

  @Column({ type: 'boolean', default: false })
  enable_gzip: boolean;

  @Index('idx_recommend_at')
  @Column({ type: 'datetime', nullable: true })
  recommend_at: Date | null;

  @Column({ type: 'varchar', length: 16, default: '.webp' })
  preview_ext: string;

  @Index('idx_uuid')
  @Column({ type: 'char', length: 16, default: '' })
  uuid: string;

  @Index('idx_language')
  @Column({ type: 'varchar', length: 16, default: '' })
  language: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  source: string;

  @Column({ type: 'varchar', length: 1024, default: '' })
  source_url: string;
}