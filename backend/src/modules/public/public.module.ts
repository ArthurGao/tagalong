import { Module } from '@nestjs/common';
import { PublicListingsController } from './public-listings.controller.js';
import { PublicListingsService } from './public-listings.service.js';
import { PublicMerchantsController } from './public-merchants.controller.js';
import { PublicMerchantsService } from './public-merchants.service.js';

@Module({ controllers: [PublicListingsController, PublicMerchantsController], providers: [PublicListingsService, PublicMerchantsService] })
export class PublicModule {}
