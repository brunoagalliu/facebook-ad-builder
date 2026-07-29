-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashed_password" TEXT NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_superuser" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#3B82F6',
    "secondary_color" TEXT NOT NULL DEFAULT '#10B981',
    "highlight_color" TEXT NOT NULL DEFAULT '#F59E0B',
    "voice" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "product_shots" JSONB,
    "default_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "demographics" TEXT,
    "pain_points" TEXT,
    "goals" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "budget_type" TEXT,
    "daily_budget" INTEGER,
    "bid_strategy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "fb_campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_adsets" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "optimization_goal" TEXT,
    "daily_budget" INTEGER,
    "bid_strategy" TEXT,
    "bid_amount" INTEGER,
    "targeting" JSONB,
    "pixel_id" TEXT,
    "conversion_event" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "fb_adset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_adsets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_ads" (
    "id" TEXT NOT NULL,
    "adset_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creative_name" TEXT,
    "image_url" TEXT,
    "media_type" TEXT NOT NULL DEFAULT 'image',
    "video_url" TEXT,
    "video_id" TEXT,
    "thumbnail_url" TEXT,
    "bodies" JSONB,
    "headlines" JSONB,
    "description" TEXT,
    "cta" TEXT,
    "website_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "fb_ad_id" TEXT,
    "fb_creative_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winning_ads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "notes" TEXT,
    "tags" TEXT,
    "analysis" TEXT,
    "recreation_prompt" TEXT,
    "topic" TEXT,
    "mood" TEXT,
    "subject_matter" TEXT,
    "copy_analysis" TEXT,
    "product_name" TEXT,
    "category" TEXT,
    "design_style" TEXT,
    "filename" TEXT,
    "structural_analysis" TEXT,
    "layering" TEXT,
    "template_structure" JSONB,
    "color_palette" JSONB,
    "typography_system" JSONB,
    "copy_patterns" JSONB,
    "visual_elements" JSONB,
    "template_category" TEXT,
    "blueprint_json" JSONB,
    "blueprint_analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winning_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_ads" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT,
    "product_id" TEXT,
    "template_id" TEXT,
    "image_url" TEXT,
    "headline" TEXT,
    "body" TEXT,
    "cta" TEXT,
    "size_name" TEXT,
    "dimensions" TEXT,
    "prompt" TEXT,
    "ad_bundle_id" TEXT,
    "media_type" TEXT NOT NULL DEFAULT 'image',
    "video_url" TEXT,
    "video_id" TEXT,
    "thumbnail_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verticals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verticals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facebook_pages" (
    "id" TEXT NOT NULL,
    "page_id" TEXT,
    "page_name" TEXT,
    "total_ads" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "country" TEXT,
    "vertical_id" TEXT,
    "negative_keywords" JSONB,
    "search_type" TEXT NOT NULL DEFAULT 'one_time',
    "schedule_config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run" TIMESTAMP(3),
    "ads_requested" INTEGER NOT NULL DEFAULT 0,
    "ads_returned" INTEGER NOT NULL DEFAULT 0,
    "ads_new" INTEGER NOT NULL DEFAULT 0,
    "ads_duplicate" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage_logs" (
    "id" TEXT NOT NULL,
    "calls_made" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_blacklist" (
    "id" TEXT NOT NULL,
    "page_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_blacklist" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_logs" (
    "id" TEXT NOT NULL,
    "api_calls_made" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraped_ads" (
    "id" TEXT NOT NULL,
    "brand_name" TEXT,
    "headline" TEXT,
    "ad_copy" TEXT,
    "cta_text" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'facebook',
    "external_id" TEXT,
    "content_hash" TEXT,
    "ad_link" TEXT NOT NULL,
    "platforms" JSONB,
    "start_date" TEXT,
    "media_type" TEXT,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "search_id" TEXT,
    "facebook_page_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraped_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_scrapes" (
    "id" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "page_url" TEXT NOT NULL,
    "page_id" TEXT,
    "page_name" TEXT,
    "total_ads" INTEGER NOT NULL DEFAULT 0,
    "media_downloaded" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_scrapes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_scraped_ads" (
    "id" TEXT NOT NULL,
    "brand_scrape_id" TEXT NOT NULL,
    "headline" TEXT,
    "ad_copy" TEXT,
    "cta_text" TEXT,
    "platforms" JSONB,
    "start_date" TEXT,
    "media_urls" JSONB,
    "original_media_urls" JSONB,
    "media_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_scraped_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "description" TEXT,
    "variables" JSONB,
    "notes" TEXT,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_styles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "best_for" TEXT,
    "visual_layout" TEXT,
    "psychology" TEXT,
    "mood" TEXT,
    "lighting" TEXT,
    "composition" TEXT,
    "design_style" TEXT,
    "prompt" TEXT,

    CONSTRAINT "ad_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_RolePermissions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_BrandProfiles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "facebook_pages_page_id_key" ON "facebook_pages"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraped_ads_external_id_key" ON "scraped_ads"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "scraped_ads_content_hash_key" ON "scraped_ads"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "_UserRoles_AB_unique" ON "_UserRoles"("A", "B");

-- CreateIndex
CREATE INDEX "_UserRoles_B_index" ON "_UserRoles"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_RolePermissions_AB_unique" ON "_RolePermissions"("A", "B");

-- CreateIndex
CREATE INDEX "_RolePermissions_B_index" ON "_RolePermissions"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_BrandProfiles_AB_unique" ON "_BrandProfiles"("A", "B");

-- CreateIndex
CREATE INDEX "_BrandProfiles_B_index" ON "_BrandProfiles"("B");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_adsets" ADD CONSTRAINT "facebook_adsets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "facebook_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facebook_ads" ADD CONSTRAINT "facebook_ads_adset_id_fkey" FOREIGN KEY ("adset_id") REFERENCES "facebook_adsets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_ads" ADD CONSTRAINT "generated_ads_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_ads" ADD CONSTRAINT "generated_ads_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "winning_ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_vertical_id_fkey" FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraped_ads" ADD CONSTRAINT "scraped_ads_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "saved_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraped_ads" ADD CONSTRAINT "scraped_ads_facebook_page_id_fkey" FOREIGN KEY ("facebook_page_id") REFERENCES "facebook_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_scraped_ads" ADD CONSTRAINT "brand_scraped_ads_brand_scrape_id_fkey" FOREIGN KEY ("brand_scrape_id") REFERENCES "brand_scrapes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_A_fkey" FOREIGN KEY ("A") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_A_fkey" FOREIGN KEY ("A") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_B_fkey" FOREIGN KEY ("B") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BrandProfiles" ADD CONSTRAINT "_BrandProfiles_A_fkey" FOREIGN KEY ("A") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BrandProfiles" ADD CONSTRAINT "_BrandProfiles_B_fkey" FOREIGN KEY ("B") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
