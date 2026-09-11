import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group, GroupPermission } from '../../entities';
import { Biz } from '../../common/biz.exception';

export interface GroupInput {
  id?: number;
  title?: string;
  color?: string;
  is_default?: boolean;
  is_display?: boolean;
  description?: string;
  user_count?: number;
  sort?: number;
  enable_upload?: boolean;
  enable_document_review?: boolean;
  enable_comment?: boolean;
  enable_comment_approval?: boolean;
  enable_article?: boolean;
  enable_article_approval?: boolean;
}

export interface ListGroupQuery {
  wd?: string;
  page?: number;
  size?: number;
  field?: string[];
}

const GROUP_FIELDS = [
  'id',
  'title',
  'color',
  'is_default',
  'is_display',
  'description',
  'user_count',
  'sort',
  'enable_upload',
  'enable_document_review',
  'enable_comment',
  'enable_comment_approval',
  'enable_article',
  'enable_article_approval',
  'created_at',
  'updated_at',
];

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepo: Repository<GroupPermission>,
  ) {}

  async createGroup(input: GroupInput): Promise<Group> {
    const title = (input.title ?? '').trim();
    if (!title) throw Biz.invalidArgument('用户组名称不能为空');

    const exists = await this.groupRepo.findOne({ where: { title } });
    if (exists) throw Biz.alreadyExists('分组名称已存在');

    if (input.is_default) {
      await this.groupRepo.update({ is_default: true }, { is_default: false });
    }

    const now = new Date();
    const group = this.groupRepo.create({
      title,
      color: input.color ?? '',
      is_default: !!input.is_default,
      is_display: !!input.is_display,
      description: input.description ?? '',
      user_count: input.user_count ?? 0,
      sort: input.sort ?? 0,
      enable_upload: !!input.enable_upload,
      enable_document_review: !!input.enable_document_review,
      enable_comment: input.enable_comment ?? true,
      enable_comment_approval: !!input.enable_comment_approval,
      enable_article: input.enable_article ?? true,
      enable_article_approval: !!input.enable_article_approval,
      created_at: now,
      updated_at: now,
    });

    return this.groupRepo.save(group);
  }

  async updateGroup(input: GroupInput): Promise<Record<string, never>> {
    if (!input.id) throw Biz.invalidArgument('用户组ID不能为空');

    const existing = await this.groupRepo.findOne({ where: { id: input.id } });
    if (!existing) throw Biz.notFound('用户组不存在');

    const totalDefaults = await this.groupRepo.count({ where: { is_default: true } });
    if (input.is_default) {
      await this.groupRepo.update({ is_default: true }, { is_default: false });
    } else if (existing.is_default && totalDefaults <= 1) {
      throw Biz.invalidArgument('至少要有一个默认用户组');
    }

    const body: Partial<Group> = {};
    const updatable: (keyof GroupInput)[] = [
      'title',
      'color',
      'is_default',
      'is_display',
      'description',
      'sort',
      'enable_upload',
      'enable_document_review',
      'enable_comment',
      'enable_comment_approval',
      'enable_article',
      'enable_article_approval',
    ];
    for (const key of updatable) {
      if (input[key] !== undefined) {
        (body as Record<string, unknown>)[key] = input[key];
      }
    }
    body.updated_at = new Date();

    await this.groupRepo.update(input.id, body);
    return {};
  }

  async deleteGroup(ids: number[]): Promise<Record<string, never>> {
    if (!ids || ids.length === 0) throw Biz.invalidArgument('请选择要删除的用户组');

    const blocked = await this.groupRepo
      .createQueryBuilder('g')
      .where('g.id IN (:...ids)', { ids })
      .andWhere('(g.user_count > :count OR g.is_default = :def)', {
        count: 0,
        def: true,
      })
      .getCount();
    if (blocked > 0) {
      throw Biz.invalidArgument('默认分组以及分组下存在用户的组不能删除');
    }

    await this.groupRepo
      .createQueryBuilder()
      .delete()
      .where('id IN (:...ids)', { ids })
      .andWhere('user_count = :count', { count: 0 })
      .execute();

    return {};
  }

  async getGroup(
    id?: number,
    title?: string,
  ): Promise<Partial<Group>> {
    if (id) {
      const group = await this.groupRepo.findOne({ where: { id } });
      return group ?? {};
    }
    if (title) {
      const group = await this.groupRepo.findOne({ where: { title } });
      return group ?? {};
    }
    return {};
  }

  async listGroup(query: ListGroupQuery): Promise<{ total: number; group: Group[] }> {
    const { wd = '', page = 0, size = 0, field = [] } = query;

    const qb = this.groupRepo.createQueryBuilder('g');
    if (wd) {
      qb.andWhere('g.title LIKE :wd', { wd: `%${wd}%` });
    }

    const total = await qb.getCount();

    qb.orderBy('g.sort', 'DESC').addOrderBy('g.id', 'ASC');
    if (page > 0 && size > 0) {
      qb.offset((page - 1) * size).limit(size);
    }
    if (field && field.length > 0) {
      const cols = field
        .filter((f) => GROUP_FIELDS.includes(f))
        .map((f) => `g.${f}`);
      if (cols.length > 0) qb.select(cols);
    }

    const group = await qb.getMany();
    return { total, group };
  }

  async getGroupPermission(id: number): Promise<{ permission_id: number[] }> {
    const rows = await this.groupPermissionRepo.find({
      where: { group_id: id },
    });
    return { permission_id: rows.map((row) => Number(row.permission_id)) };
  }

  async updateGroupPermission(
    group_id: number,
    permission_id: number[],
  ): Promise<Record<string, never>> {
    if (!group_id) throw Biz.invalidArgument('用户组ID不能为空');

    const permissionIds = Array.from(
      new Set((permission_id ?? []).map(Number).filter((id) => id > 0)),
    );

    await this.groupPermissionRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(GroupPermission);
      await repo.delete({ group_id });
      if (permissionIds.length > 0) {
        const now = new Date();
        await repo.save(
          permissionIds.map((pid) =>
            repo.create({
              group_id,
              permission_id: pid,
              created_at: now,
              updated_at: now,
            }),
          ),
        );
      }
    });

    return {};
  }
}