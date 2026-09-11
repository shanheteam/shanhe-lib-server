import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('search_record')
export class SearchRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  page: number;

  @Column({ type: 'varchar', length: 512, default: '' })
  user_agent: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  keywords: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  spend_time: number;

  @Index('idx_created_at')
  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'int', default: 0 })
  type: number;
}