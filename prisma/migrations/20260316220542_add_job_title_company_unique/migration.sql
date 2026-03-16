/*
  Warnings:

  - A unique constraint covering the columns `[title,company]` on the table `Job` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Job_title_company_key" ON "Job"("title", "company");
