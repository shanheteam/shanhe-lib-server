import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('logout')
export class Logout {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index()
  @Column({ type: 'varchar', length: 36, unique: true })
  uuid: string;

  @Index()
  @Column({ type: 'bigint', default: 0 })
  expired_at: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;
}