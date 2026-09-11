import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Public()
  @Get()
  search(@Query() query: Record<string, any>) {
    return this.service.search(query);
  }
}