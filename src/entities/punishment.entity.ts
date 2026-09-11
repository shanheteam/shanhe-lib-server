import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('punishment')
export class Punishment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'int', default: 0 })
  type: number;

  @Index('idx_enable')
  @Column({ type: 'boolean', default: false })
  enable: boolean;

  @Column({ type: 'text' })
  operators: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'text' })
  remark: string;

  @Column({ type: 'datetime', nullable: true })
  end_time: Date | null;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}