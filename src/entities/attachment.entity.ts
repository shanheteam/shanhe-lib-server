import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('attachment')
export class Attachment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('hash')
  @Column({ type: 'char', length: 32 })
  hash: string;

  @Index('user_id')
  @Column({ type: 'bigint', default: 0 })
  user_id: number;

  @Index('idx_type_id')
  @Column({ type: 'bigint', default: 0 })
  type_id: number;

  @Index('idx_type')
  @Column({ type: 'smallint', default: 0 })
  type: number;

  @Column({ type: 'boolean', default: true })
  enable: boolean;

  @Column({ type: 'varchar', length: 255, default: '' })
  path: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  name: string;

  @Column({ type: 'bigint', default: 0 })
  size: number;

  @Column({ type: 'int', default: 0 })
  width: number;

  @Column({ type: 'int', default: 0 })
  height: number;

  @Column({ type: 'varchar', length: 32, default: '' })
  ext: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description: string;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;

  @Index('idx_deleted_at')
  @Column({ type: 'datetime', nullable: true })
  deleted_at: Date | null;
}

@Entity('attachment_content')
export class AttachmentContent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index('idx_hash', { unique: true })
  @Column({ type: 'char', length: 32 })
  hash: string;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ type: 'bigint', default: 0 })
  content_size: number;

  @Column({ type: 'datetime', nullable: true })
  created_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  updated_at: Date | null;
}