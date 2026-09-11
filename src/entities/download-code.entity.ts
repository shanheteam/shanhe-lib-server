import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('download_code')
export class DownloadCode {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_code', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'tinyint', default: 0 })
  status: number; // 0=未使用, 1=已使用

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'datetime', nullable: true })
  used_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}