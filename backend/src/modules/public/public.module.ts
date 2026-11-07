import { Module } from '@nestjs/common';
import { ListingPreviewController } from './listing-preview.controller.js';
import { PublicListingsController } from './public-listings.controller.js';
import { PublicListingsService } from './public-listings.service.js';
import { PublicMerchantsController } from './public-merchants.controller.js';
import { PublicMerchantsService } from './public-merchants.service.js';

@Module({ controllers: [PublicListingsController, PublicMerchantsController, ListingPreviewController], providers: [PublicListingsService, PublicMerchantsService] })
export class PublicModule {}
