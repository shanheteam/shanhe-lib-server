import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('username', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  username: string;

  @Column({ type: 'varchar', length: 128 })
  password: string;

  @Index('mobile')
  @Column({ type: 'varchar', length: 20, default: '' })
  mobile: string;

  @Index('idx_email')
  @Column({ type: 'varchar', length: 64, default: '' })
  email: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  address: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  signature: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  last_login_ip: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  register_ip: string;

  @Column({ type: 'int', default: 0 })
  doc_count: number;

  @Column({ type: 'int', default: 0 })
  follow_count: number;

  @Column({ type: 'int', default: 0 })
  fans_count: number;

  @Column({ type: 'int', default: 0 })
  favorite_count: number;

  @Column({ type: 'int', default: 0 })
  comment_count: number;

  @Column({ type: 'int', default: 0 })
  credit_count: number;

  @Column({ type: 'int', default: 0 })
  article_count: number;

  @Column({ type: 'varchar', length: 255, default: '' })
  avatar: string;

  @Column({ type: 'char', length: 18, default: '' })
  identity: string;

  @Column({ type: 'varchar', length: 20, default: '' })
  realname: string;

  @Column({ type: 'datetime', nullable: true })
  login_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Column({ type: 'varchar', length: 255, default: '' })
  remark: string;
}