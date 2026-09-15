import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_oauth')
export class UserOauth {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_user_id')
  @Column({ type: 'bigint' })
  user_id: number;

  @Column({ type: 'int' })
  oauth_type: number;

  @Index('idx_oauth_openid')
  @Column({ type: 'varchar', length: 128 })
  openid: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  nickname: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  avatar: string;

  @Column({ type: 'varchar', length: 1024, default: '' })
  access_token: string;

  @Column({ type: 'varchar', length: 1024, default: '' })
  refresh_token: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  scope: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  unionid: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
