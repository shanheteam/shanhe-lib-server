import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('config')
@Index('name_category', ['name', 'category'], { unique: true })
@Index('category', ['category'])
export class Config {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  label: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  placeholder: string;

  @Column({ type: 'varchar', length: 32, default: 'text' })
  input_type: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  category: string;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'text' })
  options: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'boolean', default: false })
  is_secret: boolean;

  @Column({ type: 'int', default: 24 })
  col_num: number;

  @Index()
  @Column({ type: 'datetime', nullable: true })
  deleted_at: Date | null;
}