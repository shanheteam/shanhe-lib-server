import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('email_code')
export class EmailCode {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_email')
  @Column({ type: 'varchar', length: 64, default: '' })
  email: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Column({ type: 'varchar', length: 16, default: '' })
  code: string;

  @Column({ type: 'smallint', default: 0 })
  code_type: number;

  @Column({ type: 'boolean', default: false })
  success: boolean;

  @Column({ type: 'text' })
  error: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'boolean', default: false })
  is_used: boolean;
}