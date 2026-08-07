-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "vertical_id" TEXT;

-- AlterTable
ALTER TABLE "winning_ads" ADD COLUMN     "source_run_duration_days" INTEGER;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

