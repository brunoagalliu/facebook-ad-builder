-- AlterTable
ALTER TABLE "scraped_ads" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "impressions_lower" INTEGER,
ADD COLUMN     "impressions_upper" INTEGER,
ADD COLUMN     "spend_lower" INTEGER,
ADD COLUMN     "spend_upper" INTEGER,
ADD COLUMN     "stop_date" TEXT;
