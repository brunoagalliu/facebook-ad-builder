-- DropIndex
DROP INDEX "facebook_pages_page_id_key";

-- AlterTable
ALTER TABLE "api_usage_logs" DROP COLUMN "calls_made",
ADD COLUMN     "ads_returned" INTEGER NOT NULL,
ADD COLUMN     "ads_saved" INTEGER NOT NULL,
ADD COLUMN     "api_calls" INTEGER NOT NULL,
ADD COLUMN     "date" TEXT NOT NULL,
ADD COLUMN     "endpoint" TEXT NOT NULL,
ADD COLUMN     "query" TEXT;

-- AlterTable
ALTER TABLE "brand_scraped_ads" ADD COLUMN     "ad_link" TEXT,
ADD COLUMN     "external_id" TEXT NOT NULL,
ADD COLUMN     "page_link" TEXT,
ADD COLUMN     "page_name" TEXT;

-- AlterTable
ALTER TABLE "brand_scrapes" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "page_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "facebook_pages" DROP COLUMN "page_id",
ADD COLUMN     "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "page_url" TEXT,
ADD COLUMN     "vertical_id" TEXT,
ALTER COLUMN "page_name" SET NOT NULL;

-- AlterTable
ALTER TABLE "keyword_blacklist" ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "page_blacklist" ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "saved_searches" ALTER COLUMN "ads_requested" DROP NOT NULL,
ALTER COLUMN "ads_requested" DROP DEFAULT,
ALTER COLUMN "ads_returned" DROP NOT NULL,
ALTER COLUMN "ads_returned" DROP DEFAULT,
ALTER COLUMN "ads_new" DROP NOT NULL,
ALTER COLUMN "ads_new" DROP DEFAULT,
ALTER COLUMN "ads_duplicate" DROP NOT NULL,
ALTER COLUMN "ads_duplicate" DROP DEFAULT;

-- AlterTable
ALTER TABLE "search_logs" ADD COLUMN     "country" TEXT,
ADD COLUMN     "date" TEXT NOT NULL,
ADD COLUMN     "execution_time_seconds" INTEGER,
ADD COLUMN     "filtered_by_keyword_blacklist" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "filtered_by_page_blacklist" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "final_ads_saved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "negative_keywords" JSONB,
ADD COLUMN     "new_pages_blacklisted" JSONB,
ADD COLUMN     "search_query" TEXT NOT NULL,
ADD COLUMN     "search_type" TEXT,
ADD COLUMN     "total_ads_found" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vertical_id" TEXT;

-- AlterTable
ALTER TABLE "verticals" ADD COLUMN     "description" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "facebook_pages_page_name_key" ON "facebook_pages"("page_name");

-- CreateIndex
CREATE UNIQUE INDEX "keyword_blacklist_keyword_key" ON "keyword_blacklist"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "page_blacklist_page_name_key" ON "page_blacklist"("page_name");

-- CreateIndex
CREATE UNIQUE INDEX "verticals_name_key" ON "verticals"("name");

-- AddForeignKey
ALTER TABLE "facebook_pages" ADD CONSTRAINT "facebook_pages_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_logs" ADD CONSTRAINT "search_logs_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

