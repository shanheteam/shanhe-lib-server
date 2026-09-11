import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('friendlink')
export class Friendlink {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  title: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  link: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'boolean', default: false })
  enable: boolean;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}