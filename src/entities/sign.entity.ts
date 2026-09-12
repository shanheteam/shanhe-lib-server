import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sign')
@Index('idx_user_sign_at', ['user_id', 'sign_at'], { unique: true })
@Index('idx_user_id', ['user_id'])
export class Sign {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Column({ type: 'int', default: 0 })
  sign_at: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'int', default: 0 })
  award: number;
}