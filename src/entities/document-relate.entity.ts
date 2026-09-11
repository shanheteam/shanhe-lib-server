import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('document_relate')
export class DocumentRelate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_document_id', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Column({ type: 'text' })
  related_document_id: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}