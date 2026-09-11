import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('download')
export class Download {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index('idx_document_id')
  @Column({ type: 'bigint', default: 0 })
  document_id: number;

  @Index('idx_ip')
  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Column({ type: 'boolean', default: false })
  is_pay: boolean;

  @Index('idx_created_at')
  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}