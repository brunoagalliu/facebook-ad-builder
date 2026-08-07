-- AlterTable
ALTER TABLE "winning_ads" ADD COLUMN     "media_type" TEXT NOT NULL DEFAULT 'image',
ADD COLUMN     "video_blueprint_json" JSONB,
ADD COLUMN     "video_url" TEXT;

