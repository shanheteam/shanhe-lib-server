import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('comment')
export class Comment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index('idx_parent_id')
  @Column({ type: 'bigint', default: 0 })
  parent_id: number;

  @Column({ type: 'text' })
  content: string;

  @Index('idx_document_id')
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Column({ type: 'tinyint', default: 0 })
  status: number;

  @Column({ type: 'int', default: 0 })
  comment_count: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Index('idx_created_at')
  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Index('idx_type')
  @Column({ type: 'int', default: 0 })
  type: number;
}