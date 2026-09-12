import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('favorite')
@Index('idx_user_document_type', ['user_id', 'document_id', 'type'], { unique: true })
@Index('idx_user_id', ['user_id'])
@Index('idx_type', ['type'])
export class Favorite {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Column({ type: 'int', default: 0 })
  type: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;
}