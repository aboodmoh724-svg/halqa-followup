ALTER TABLE "Supervisor" ADD COLUMN "codeLookup" TEXT, ADD COLUMN "codeHash" TEXT;
CREATE UNIQUE INDEX "Supervisor_codeLookup_key" ON "Supervisor"("codeLookup");
