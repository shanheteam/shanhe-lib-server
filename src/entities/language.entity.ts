import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('language')
export class Language {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  language: string;

  @Index('idx_enable')
  @Column({ type: 'boolean', default: false })
  enable: boolean;

  @Index('idx_code', { unique: true })
  @Column({ type: 'varchar', length: 16, default: '' })
  code: string;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}