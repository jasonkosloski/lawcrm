-- AlterTable
ALTER TABLE "court_formats" ADD COLUMN     "styleOverrides" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "document_styles" ADD COLUMN     "paragraphStyles" JSONB;
