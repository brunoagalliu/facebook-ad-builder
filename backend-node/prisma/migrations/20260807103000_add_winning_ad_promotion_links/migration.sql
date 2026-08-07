-- AlterTable
ALTER TABLE "scraped_ads" ADD COLUMN     "ad_snapshot_url" TEXT;

-- AlterTable
ALTER TABLE "winning_ads" ADD COLUMN     "source_scraped_ad_id" TEXT,
ADD COLUMN     "vertical_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "winning_ads_source_scraped_ad_id_key" ON "winning_ads"("source_scraped_ad_id");

-- AddForeignKey
ALTER TABLE "winning_ads" ADD CONSTRAINT "winning_ads_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winning_ads" ADD CONSTRAINT "winning_ads_source_scraped_ad_id_fkey" FOREIGN KEY ("source_scraped_ad_id") REFERENCES "scraped_ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

