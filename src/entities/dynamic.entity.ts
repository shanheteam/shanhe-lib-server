import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('dynamic')
export class Dynamic {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'text' })
  content: string;

  @Index('idx_type')
  @Column({ type: 'smallint', default: 0 })
  type: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}