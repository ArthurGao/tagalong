import { Module } from '@nestjs/common';
import { PublicListingsController } from './public-listings.controller.js';
import { PublicListingsService } from './public-listings.service.js';

@Module({ controllers: [PublicListingsController], providers: [PublicListingsService] })
export class PublicModule {}
