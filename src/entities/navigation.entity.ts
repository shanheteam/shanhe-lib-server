import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('navigation')
export class Navigation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  href: string;

  @Column({ type: 'varchar', length: 16, default: '' })
  target: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  color: string;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'boolean', default: false })
  enable: boolean;

  @Column({ type: 'int', default: 0 })
  parent_id: number;

  @Column({ type: 'varchar', length: 1024, default: '' })
  description: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'boolean', default: false })
  fixed: boolean;
}