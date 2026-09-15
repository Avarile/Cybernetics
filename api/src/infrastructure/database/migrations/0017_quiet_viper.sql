-- Binds each conversation to a registered agent.
--
-- Hand-edited after `drizzle-kit generate` (precedent: 0009_backfill_conversation_titles.sql).
-- The generated statement added the column with the new `assistant` default,
-- which would have retroactively relabelled every existing conversation: all of
-- them predate the roster and were in fact run by the orchestrator. Adding the
-- column with the OLD value as its default backfills the existing rows truthfully,
-- and the second statement then points new rows at the new default.
ALTER TABLE "agent_conversation" ADD COLUMN "agent_id" text DEFAULT 'orchestrator' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_conversation" ALTER COLUMN "agent_id" SET DEFAULT 'assistant';
