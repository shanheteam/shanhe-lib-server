import { Global, Module } from '@nestjs/common';
import { ConverterService } from './converter.service';

@Global()
@Module({
  providers: [ConverterService],
  exports: [ConverterService],
})
export class ConverterModule {}