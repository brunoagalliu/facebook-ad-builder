-- CreateTable
CREATE TABLE "ai_generation_logs" (
    "id" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "task_id" TEXT,
    "brand_id" TEXT,
    "generated_ad_id" TEXT,
    "balance_before" DOUBLE PRECISION,
    "balance_after" DOUBLE PRECISION,
    "cost_amount" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_generation_logs_task_id_idx" ON "ai_generation_logs"("task_id");

-- CreateIndex
CREATE INDEX "ai_generation_logs_status_idx" ON "ai_generation_logs"("status");

-- CreateIndex
CREATE INDEX "ai_generation_logs_started_at_idx" ON "ai_generation_logs"("started_at");

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_generated_ad_id_fkey" FOREIGN KEY ("generated_ad_id") REFERENCES "generated_ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
