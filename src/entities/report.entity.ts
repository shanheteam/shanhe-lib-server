import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('report')
export class Report {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_document_id')
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  document_title: string;

  @Index('idx_user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  username: string;

  @Column({ type: 'int', default: 0 })
  reason: number;

  @Index('idx_status')
  @Column({ type: 'boolean', default: false })
  status: boolean;

  @Column({ type: 'varchar', length: 255, default: '' })
  remark: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}