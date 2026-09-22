import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { Category } from '../../entities/category.entity';
import { Biz } from '../../common/biz.exception';
import { PermissionService } from '../../auth/permission.service';
import { JwtUser } from '../../auth/jwt-user.type';
import { toNumberArray, toBoolArray } from '../../common/query.util';

export const CATEGORY_TYPE_DOCUMENT = 0;
export const CATEGORY_TYPE_ARTICLE = 1;

export interface CategoryInput {
  id?: number;
  icon?: string;
  cover?: string;
  parent_id?: number;
  title?: string;
  doc_count?: number;
  type?: number;
  sort?: number;
  enable?: boolean;
  description?: string;
  show_description?: boolean;
}

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
    private readonly permissionService: PermissionService,
  ) {}

  async create(input: CategoryInput): Promise<Record<string, never>> {
    if (!input.title || !String(input.title).trim()) {
      throw Biz.invalidArgument('分类名称不能为空');
    }
    const type = input.type ?? CATEGORY_TYPE_DOCUMENT;
    const parentId = Number(input.parent_id) || 0;
    const titles = String(input.title).split('\n');

    for (const raw of titles) {
      const title = (raw || '').trim();
      if (!title) continue;

      const exist = await this.repo.findOne({
        where: { parent_id: parentId, title, type },
        select: { id: true },
      });
      if (exist && exist.id > 0) continue;

      const now = new Date();
      await this.repo.save(
        this.repo.create({
          icon: input.icon ?? '',
          cover: input.cover ?? '',
          parent_id: parentId,
          title,
          doc_count: Number(input.doc_count) || 0,
          type,
          sort: Number(input.sort) || 0,
          enable: input.enable === undefined ? true : !!input.enable,
          description: input.description ?? '',
          show_description: !!input.show_description,
          created_at: now,
          updated_at: now,
        }),
      );
    }
    return {};
  }

  async update(input: CategoryInput): Promise<Record<string, never>> {
    const id = Number(input.id) || 0;
    if (id <= 0) throw Biz.invalidArgument('缺少分类ID');
    if (!input.title || !String(input.title).trim()) {
      throw Biz.invalidArgument('分类名称不能为空');
    }

    const type = input.type ?? CATEGORY_TYPE_DOCUMENT;
    const parentId = Number(input.parent_id) || 0;
    const title = String(input.title).trim();

    // 同级同名校验：在 SQL 里显式排除自身。
    // MySQL 默认排序规则大小写不敏感，findOne 可能命中"另一个同名分类"
    // （例如库里同时存在 Java / java），此时仅编辑自身也会被误判为名称重复。
    const exist = await this.repo
      .createQueryBuilder('c')
      .select(['c.id', 'c.title'])
      .where('c.parent_id = :parentId', { parentId })
      .andWhere('c.title = :title', { title })
      .andWhere('c.type = :type', { type })
      .andWhere('c.id != :id', { id })
      .getOne();
    if (exist) {
      throw Biz.invalidArgument(
        `同级下已存在同名分类「${exist.title}」(ID ${exist.id})，请改名或先处理该分类`,
      );
    }

    await this.repo.update(id, {
      icon: input.icon ?? '',
      cover: input.cover ?? '',
      parent_id: parentId,
      title,
      doc_count: Number(input.doc_count) || 0,
      type,
      sort: Number(input.sort) || 0,
      enable: input.enable === undefined ? true : !!input.enable,
      description: input.description ?? '',
      show_description: !!input.show_description,
      updated_at: new Date(),
    });
    return {};
  }

  async remove(ids: unknown): Promise<Record<string, never>> {
    const idList = toNumberArray(ids);
    await this.deleteRecursive(idList);
    return {};
  }

  private async deleteRecursive(ids: number[]): Promise<void> {
    if (!ids.length) return;

    const children = await this.repo.find({
      where: { parent_id: In(ids), doc_count: 0 },
      select: { id: true },
    });
    const childIds = children.map((c) => c.id).filter((id) => id > 0);
    if (childIds.length) await this.deleteRecursive(childIds);

    await this.repo.delete({ id: In(ids), doc_count: 0 });
  }

  async get(id: unknown): Promise<Category> {
    const idNum = toNumberArray(id)[0] || 0;
    const cate = await this.repo.findOne({ where: { id: idNum } });
    if (!cate) throw Biz.notFound('分类不存在');
    return cate;
  }

  async list(
    query: Record<string, any>,
    user?: JwtUser,
  ): Promise<{ total: number; category: Category[] }> {
    const page = Math.max(1, Number(query.page) || 1);
    const size = Number(query.size) || 10;
    const isAdmin = user
      ? await this.permissionService.isAdmin(user.userId)
      : false;

    const where: Record<string, any> = {};

    const types = toNumberArray(query.type);
    where.type = types.length ? In(types) : CATEGORY_TYPE_DOCUMENT;

    const parentIds = toNumberArray(query.parent_id);
    if (parentIds.length) where.parent_id = In(parentIds);

    if (isAdmin && query.wd) where.title = Like(`%${query.wd}%`);

    const enables = toBoolArray(query.enable);
    if (enables.length) where.enable = In(enables);
    else if (!isAdmin) where.enable = true;

    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { parent_id: 'ASC', sort: 'DESC', title: 'ASC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { total, category: rows };
  }
}