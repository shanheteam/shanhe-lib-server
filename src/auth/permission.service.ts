import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Permission, UserGroup, GroupPermission } from '../entities';
import { ROOT_USER_ID } from '../common/root-user.constant';

/**
 * RBAC 权限判断：与原版 model.CheckPermissionByUserId 对齐。
 * - 用户 ID == 1 为 root，拥有全部权限；
 * - 否则通过 user_group -> group_permission -> permission(method+path) 判断。
 */
@Injectable()
export class PermissionService {
  /** 权限项缓存：permission 表基本是静态数据，缓存在鉴权热路径上避免反复查库/写库 */
  private readonly permissionCache = new Map<string, Permission>();
  /** 同一权限项并发首次访问时合并为一次查询，避免并发插入重复记录 */
  private readonly permissionPending = new Map<string, Promise<Permission>>();

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepo: Repository<GroupPermission>,
  ) {}

  private async getPermission(method: string, path: string): Promise<Permission> {
    const key = `${method}|${path}`;
    const cached = this.permissionCache.get(key);
    if (cached) return cached;

    const pending = this.permissionPending.get(key);
    if (pending) return pending;

    const task = (async () => {
      let permission = await this.permissionRepo.findOne({ where: { method, path } });
      if (!permission) {
        // 与原版 GetPermissionByMethodPath(createIfNotExist=true) 对齐：不存在则自动创建
        permission = await this.permissionRepo.save({
          method,
          path,
          title: path,
          description: '',
        } as any);
      }
      this.permissionCache.set(key, permission);
      return permission;
    })();

    this.permissionPending.set(key, task);
    try {
      return await task;
    } finally {
      this.permissionPending.delete(key);
    }
  }

  async check(userId: number, grpcMethod: string): Promise<boolean> {
    if (userId <= 0) return false;
    if (userId === ROOT_USER_ID) return true;

    const permission = await this.getPermission('GRPC', grpcMethod);

    // 用户组是否被授权：user_group 与 group_permission 用一次 JOIN 查询完成
    const gp = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = gp.group_id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('ug.group_id > 0')
      .andWhere('gp.permission_id = :pid', { pid: permission.id })
      .getOne();

    return !!gp;
  }

  /** 是否为管理员（拥有任意 group_permission 记录，或 ID==1） */
  async isAdmin(userId: number): Promise<boolean> {
    if (userId <= 0) return false;
    if (userId === ROOT_USER_ID) return true;

    const gp = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = gp.group_id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('ug.group_id > 0')
      .getOne();

    return !!gp;
  }

  /**
   * 返回用户当前拥有的 GRPC 权限 path 集合。
   * root 返回 null 表示拥有全部权限。
   */
  async getUserGrantedPaths(userId: number): Promise<Set<string> | null> {
    if (userId === ROOT_USER_ID) return null;

    const rows = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = gp.group_id')
      .innerJoin(Permission, 'p', 'p.id = gp.permission_id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('ug.group_id > 0')
      .select(['p.path AS path', 'p.method AS method'])
      .getRawMany<{ path: string; method: string }>();

    const set = new Set<string>();
    for (const row of rows) {
      if (row.method === 'GRPC') set.add(row.path);
    }
    return set;
  }

  /**
   * 可分配上限限制：调用者是否有权把给定权限授予出去。
   * - root 拥有全部，恒为 true；
   * - 非 GRPC 权限（如 upload 前端映射）不参与上限限制；
   * - 否则要求调用者本身已拥有该权限，低权限管理员不能把比自己更高/更多的权限分配出去。
   */
  async canAssignPermission(userId: number, permissionIds: number[]): Promise<boolean> {
    if (userId === ROOT_USER_ID) return true;
    if (!permissionIds || permissionIds.length === 0) return true;

    const granted = await this.getUserGrantedPaths(userId);
    // userId 非 root 时 granted 必不为 null；防御性兜底
    if (!granted) return true;

    const perms = await this.permissionRepo.find({
      where: { id: In([...new Set(permissionIds)].filter((id) => id > 0)) },
    });
    for (const p of perms) {
      if (p.method !== 'GRPC') continue;
      if (!granted.has(p.path)) return false;
    }
    return true;
  }
}