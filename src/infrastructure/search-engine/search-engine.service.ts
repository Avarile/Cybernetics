import { Injectable } from '@nestjs/common';
import type { SearchEngine } from './search-engine.interface';

@Injectable()
export class SearchEngineService implements Partial<SearchEngine> {}
