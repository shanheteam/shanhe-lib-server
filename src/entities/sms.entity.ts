import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 短信验证码发送记录（专业版）
 */
@Entity('sms')
export class Sms {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  // 0注册 1登录 2找回密码
  @Index()
  @Column({ type: 'int', default: 0 })
  type: number;

  // 0发送中 1发送成功 2发送失败
  @Index()
  @Column({ type: 'int', default: 0 })
  status: number;

  @Index()
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index()
  @Column({ type: 'varchar', length: 20, default: '' })
  mobile: string;

  @Column({ type: 'varchar', length: 16, default: '' })
  code: string;

  @Column({ type: 'varchar', length: 45, default: '' })
  ip: string;

  // smsAliyun / smsTencent / smsBaidu / smsHuawei / smsHaomas
  @Column({ type: 'varchar', length: 32, default: '' })
  provider: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  error: string;

  @Column({ type: 'text' })
  response: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}
