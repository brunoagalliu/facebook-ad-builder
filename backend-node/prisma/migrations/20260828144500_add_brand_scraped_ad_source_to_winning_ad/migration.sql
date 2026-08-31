-- AlterTable
ALTER TABLE "winning_ads" ADD COLUMN     "source_brand_scraped_ad_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "winning_ads_source_brand_scraped_ad_id_key" ON "winning_ads"("source_brand_scraped_ad_id");

-- AddForeignKey
ALTER TABLE "winning_ads" ADD CONSTRAINT "winning_ads_source_brand_scraped_ad_id_fkey" FOREIGN KEY ("source_brand_scraped_ad_id") REFERENCES "brand_scraped_ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
