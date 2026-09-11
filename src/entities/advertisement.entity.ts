import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('advertisement')
export class Advertisement {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index('idx_position')
  @Column({ type: 'varchar', length: 64, default: '' })
  position: string;

  @Column({ type: 'datetime', nullable: true })
  start_time: Date | null;

  @Column({ type: 'datetime', nullable: true })
  end_time: Date | null;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ type: 'boolean', default: true })
  enable: boolean;

  @Column({ type: 'text' })
  remark: string;
}