import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('document_category')
@Index('idx_doc_cate', ['document_id', 'category_id'], { unique: true })
@Index('document_id', ['document_id'])
@Index('category_id', ['category_id'])
export class DocumentCategory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Column({ type: 'bigint', default: 0 })
  category_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}