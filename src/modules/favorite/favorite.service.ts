import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  Article,
  Document,
  Favorite,
  Punishment,
  User,
} from '../../entities';
import { Biz } from '../../common/biz.exception';

// 收藏类型（model/favorite.go）
const FAVORITE_TYPE_ARTICLE = 1;

// 惩罚类型（model/punishment.go）
const PUNISHMENT_DISABLED = 1;
const PUNISHMENT_FAVORITE_LIMITED = 5;

@Injectable()
export class FavoriteService {
  constructor(
    @InjectRepository(Favorite)
    private readonly favoriteRepo: Repository<Favorite>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Punishment)
    private readonly punishmentRepo: Repository<Punishment>,
  ) {}

  private async isInPunishing(userId: number, types: number[]): Promise<boolean> {
    if (userId <= 1) return false;
    const row = await this.punishmentRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.enable = :enable', { enable: true })
      .andWhere('p.type IN (:...types)', { types })
      .andWhere('(p.end_time IS NULL OR p.end_time > :now)', { now: new Date() })
      .getOne();
    return !!row;
  }

  async createFavorite(
    userId: number,
    body: Record<string, any>,
    ip: string,
  ): Promise<Record<string, unknown>> {
    if (await this.isInPunishing(userId, [PUNISHMENT_FAVORITE_LIMITED, PUNISHMENT_DISABLED])) {
      throw Biz.permissionDenied('您已经被禁止使用收藏功能');
    }

    const documentId = Number(body.document_id) || 0;
    const type = Number(body.type) || 0;
    if (documentId <= 0) throw Biz.invalidArgument('document_id不能为空');

    const exists = await this.favoriteRepo.findOne({
      where: { user_id: userId, document_id: documentId, type },
    });
    if (exists) throw Biz.alreadyExists('您已经收藏过了');

    const now = new Date();
    const favorite = await this.favoriteRepo.manager.transaction(
      async (manager: EntityManager): Promise<Favorite> => {
        const entity = manager.create(Favorite, {
          user_id: userId,
          document_id: documentId,
          type,
          ip: ip || '',
          created_at: now,
          updated_at: now,
        } as Favorite);
        const saved = await manager.save(entity);

        if (type === FAVORITE_TYPE_ARTICLE) {
          await manager.increment(Article, { id: documentId }, 'favorite_count', 1);
        } else {
          await manager.increment(Document, { id: documentId }, 'favorite_count', 1);
        }
        await manager.increment(User, { id: userId }, 'favorite_count', 1);
        return saved;
      },
    );

    return this.serialize(favorite, {});
  }

  async deleteFavorite(userId: number, ids: number[]): Promise<void> {
    if (!ids.length || userId <= 0) return;
    const favorites = await this.favoriteRepo.find({
      where: { id: In(ids), user_id: userId },
    });
    if (!favorites.length) return;

    await this.favoriteRepo.manager.transaction(async (manager: EntityManager) => {
      await manager.remove(favorites);
      for (const favorite of favorites) {
        if (favorite.type === FAVORITE_TYPE_ARTICLE) {
          await manager.decrement(Article, { id: favorite.document_id }, 'favorite_count', 1);
        } else {
          await manager.decrement(Document, { id: favorite.document_id }, 'favorite_count', 1);
        }
        await manager.decrement(User, { id: favorite.user_id }, 'favorite_count', 1);
      }
    });
  }

  async getFavorite(
    userId: number,
    documentId: number,
    type: number,
  ): Promise<Record<string, unknown>> {
    const favorite = await this.favoriteRepo.findOne({
      where: { user_id: userId, document_id: documentId, type },
    });
    return favorite ? this.serialize(favorite, {}) : {};
  }

  async listFavorite(
    userId: number,
    type: number,
    query: Record<string, any>,
  ): Promise<{ total: number; favorite: Record<string, unknown>[] }> {
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(Math.max(1, Number(query.size) || 10), 100);

    const [rows, total] = await this.favoriteRepo.findAndCount({
      where: { user_id: userId, type },
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });

    const ids = rows.map((f) => f.document_id).filter((id) => id > 0);
    const infoMap = new Map<number, Record<string, unknown>>();
    if (ids.length) {
      if (type === FAVORITE_TYPE_ARTICLE) {
        const articles = await this.articleRepo.find({ where: { id: In(ids) } });
        for (const a of articles) {
          infoMap.set(Number(a.id), { title: a.title, document_uuid: a.identifier });
        }
      } else {
        const docs = await this.documentRepo.find({ where: { id: In(ids) } });
        for (const d of docs) {
          infoMap.set(Number(d.id), {
            title: d.title,
            ext: d.ext,
            score: d.score,
            size: d.size,
            pages: d.pages,
            document_uuid: d.uuid,
          });
        }
      }
    }

    return {
      total,
      favorite: rows.map((f) => this.serialize(f, infoMap.get(Number(f.document_id)) ?? {})),
    };
  }

  private serialize(
    f: Favorite,
    info: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      id: Number(f.id),
      user_id: Number(f.user_id),
      document_id: Number(f.document_id),
      type: f.type,
      ip: f.ip,
      created_at: f.created_at,
      updated_at: f.updated_at,
      title: (info.title as string) ?? '',
      ext: (info.ext as string) ?? '',
      score: (info.score as number) ?? 0,
      size: (info.size as number) ?? 0,
      pages: (info.pages as number) ?? 0,
      document_uuid: (info.document_uuid as string) ?? '',
    };
  }
}