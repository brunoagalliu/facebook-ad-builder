/*
  Warnings:

  - The `best_for` column on the `ad_styles` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "_BrandProfiles" ADD CONSTRAINT "_BrandProfiles_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_BrandProfiles_AB_unique";

-- AlterTable
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_RolePermissions_AB_unique";

-- AlterTable
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_UserRoles_AB_unique";

-- AlterTable
ALTER TABLE "ad_styles" DROP COLUMN "best_for",
ADD COLUMN     "best_for" JSONB;
