import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { Merchant } from '../../generated/prisma/client.js';
import { isRecordNotFound, isUniqueViolation } from '../../prisma/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateMerchantDto, MerchantDto, UpdateMerchantDto } from './merchant.dto.js';

// Explicit mapping: never return the Prisma model (DESIGN backend conventions).
export function toMerchantDto(m: Merchant): MerchantDto {
  return {
    id: m.id,
    slug: m.slug,
    displayName: m.displayName,
    description: m.description,
    logoUrl: m.logoUrl,
    contactEmail: m.contactEmail,
    contactPhone: m.contactPhone,
    gstNumber: m.gstNumber,
    status: m.status,
    chargesEnabled: m.chargesEnabled,
    payoutsEnabled: m.payoutsEnabled,
    detailsSubmitted: m.detailsSubmitted,
    createdAt: m.createdAt,
  };
}

const profileExists = () => new AppError('MERCHANT_PROFILE_EXISTS', 'This account already has a merchant profile');
const noProfile = () => new AppError('NOT_FOUND', 'No merchant profile yet');

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerUserId: string, dto: CreateMerchantDto): Promise<Merchant> {
    try {
      return await this.prisma.merchant.create({ data: { ...dto, ownerUserId } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Both owner_user_id and slug are unique; tell them apart by whether the owner now has a profile.
      const owned = await this.prisma.merchant.findUnique({ where: { ownerUserId }, select: { id: true } });
      throw owned ? profileExists() : new AppError('SLUG_TAKEN', 'This slug is already taken');
    }
  }

  async getOwn(ownerUserId: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findUnique({ where: { ownerUserId } });
    if (!merchant) throw noProfile();
    return merchant;
  }

  async updateOwn(ownerUserId: string, dto: UpdateMerchantDto): Promise<Merchant> {
    try {
      return await this.prisma.merchant.update({ where: { ownerUserId }, data: dto });
    } catch (e) {
      if (isRecordNotFound(e)) throw noProfile();
      throw e;
    }
  }
}
