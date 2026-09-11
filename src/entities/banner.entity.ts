import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('banner')
export class Banner {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description: string;

  @Column({ type: 'varchar', length: 255 })
  path: string;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'boolean', default: true })
  enable: boolean;

  @Column({ type: 'tinyint', default: 0 })
  type: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'varchar', length: 255, default: '' })
  url: string;
}