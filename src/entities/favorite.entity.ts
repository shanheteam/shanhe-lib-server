import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('favorite')
export class Favorite {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_user_id')
  @Index('idx_user_document_type', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index('idx_user_document_type', { unique: true })
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Index('idx_type')
  @Index('idx_user_document_type', { unique: true })
  @Column({ type: 'int', default: 0 })
  type: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;
}