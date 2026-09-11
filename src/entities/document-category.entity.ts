import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('document_category')
export class DocumentCategory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('document_id')
  @Index('idx_doc_cate', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Index('category_id')
  @Index('idx_doc_cate', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  category_id: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}