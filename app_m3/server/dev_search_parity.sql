-- Build-1 Lakebase Search parity on the dev branch: the app's Assist layer retrieves from these
-- BM25 indexes (lakebase_text extension), NOT a separate vector store. offer_search +
-- service_history_search mirror the Build-1 search corpus; the lakebase_bm25 indexes are the
-- Build-1 Lakebase Search indexes the app's search.py queries via to_bm25query() + the <@> operator.
CREATE EXTENSION IF NOT EXISTS lakebase_text CASCADE;
CREATE INDEX IF NOT EXISTS idx_offer_search_bm25
  ON public.offer_search USING lakebase_bm25 (description_tsv tsvector_bm25_ops);
CREATE INDEX IF NOT EXISTS idx_service_history_bm25
  ON public.service_history_search USING lakebase_bm25 (summary_tsv tsvector_bm25_ops);
