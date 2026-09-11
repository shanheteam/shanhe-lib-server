import { Injectable } from '@nestjs/common';
import { ArticleService } from '../article/article.service';
import { DocumentService } from '../document/document.service';

/**
 * 综合搜索服务：同时检索文档与文章，返回聚合结果。
 * 对应 moredoc-web-pro 的 GET /api/v1/search 契约，
 * 每个结果携带 doc_type（0=文档，1=文章）用于前端区分跳转。
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly documentService: DocumentService,
    private readonly articleService: ArticleService,
  ) {}

  async search(query: Record<string, any>): Promise<Record<string, any>> {
    const started = Date.now();
    const wd = String(query.wd || '').trim();
    if (!wd) return { total: 0, spend: '0.000', docs: [] };

    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.max(1, Math.min(24, Number(query.size) || 10));

    const [docRes, articleRes] = await Promise.all([
      this.documentService.searchDocument({ ...query, page, size }),
      this.articleService.search({ ...query, page, size }),
    ]);

    const docs: any[] = [];

    for (const d of docRes.document || []) {
      docs.push({
        doc_type: 0,
        id: d.id,
        identifier: d.uuid || d.identifier || String(d.id),
        title: d.title,
        keywords: d.keywords || '',
        description: d.description || '',
        created_at: d.created_at,
        ext: d.ext || '',
      });
    }

    for (const a of articleRes.article || []) {
      docs.push({
        doc_type: 1,
        id: a.id,
        identifier: a.identifier,
        title: a.title,
        keywords: a.keywords || '',
        description: a.description || '',
        created_at: a.created_at,
        ext: '',
      });
    }

    docs.sort(
      (x, y) =>
        new Date(y.created_at || 0).getTime() -
        new Date(x.created_at || 0).getTime(),
    );

    const total = (docRes.total || 0) + (articleRes.total || 0);
    return {
      total,
      spend: ((Date.now() - started) / 1000).toFixed(3),
      docs,
    };
  }
}