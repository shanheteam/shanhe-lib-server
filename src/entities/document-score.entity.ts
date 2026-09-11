import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('document_score')
export class DocumentScore {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_document_user', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Index('idx_document_user', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'int', default: 0 })
  score: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}