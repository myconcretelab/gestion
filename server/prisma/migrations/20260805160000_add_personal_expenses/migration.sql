CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'both',
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "expense_recurring_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "label" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "amount" REAL NOT NULL DEFAULT 0,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "category_id" TEXT NOT NULL,
    "gestionnaire_id" TEXT,
    "gite_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "expense_recurring_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expense_recurring_rules_gestionnaire_id_fkey" FOREIGN KEY ("gestionnaire_id") REFERENCES "gestionnaires" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expense_recurring_rules_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "expense_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "label" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "expense_date" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "notes" TEXT NOT NULL DEFAULT '',
    "category_id" TEXT NOT NULL,
    "gestionnaire_id" TEXT,
    "gite_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "expense_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expense_entries_gestionnaire_id_fkey" FOREIGN KEY ("gestionnaire_id") REFERENCES "gestionnaires" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expense_entries_gite_id_fkey" FOREIGN KEY ("gite_id") REFERENCES "gites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "expense_categories_scope_name_key" ON "expense_categories"("scope", "name");
CREATE INDEX "expense_categories_scope_order_idx" ON "expense_categories"("scope", "ordre");
CREATE INDEX "expense_recurring_rules_scope_start_idx" ON "expense_recurring_rules"("scope", "start_date");
CREATE INDEX "expense_recurring_rules_manager_idx" ON "expense_recurring_rules"("gestionnaire_id");
CREATE INDEX "expense_recurring_rules_gite_idx" ON "expense_recurring_rules"("gite_id");
CREATE INDEX "expense_recurring_rules_category_idx" ON "expense_recurring_rules"("category_id");
CREATE INDEX "expense_entries_scope_date_idx" ON "expense_entries"("scope", "expense_date");
CREATE INDEX "expense_entries_manager_idx" ON "expense_entries"("gestionnaire_id");
CREATE INDEX "expense_entries_gite_idx" ON "expense_entries"("gite_id");
CREATE INDEX "expense_entries_category_idx" ON "expense_entries"("category_id");
