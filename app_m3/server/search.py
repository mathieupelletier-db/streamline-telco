"""Lakebase Search (BM25 via lakebase_text) retrieval for the Assist layer.

Grounds the assistant's 'why is this subscriber at risk' explanation on the subscriber's own
service history + the matching offer, retrieved from the Build-1 BM25 indexes — NOT a separate
vector store.
"""
from .db import query

# BM25 <@> operator sorts ascending (more-negative = stronger match).


def search_service_history(nl_query: str, limit: int = 5) -> list[dict]:
    return query(
        """
        SELECT s.subscriber_id, s.home_metro, s.risk_band, s.churn_reason, s.service_summary,
               ROUND((s.summary_tsv <@> to_bm25query(
                   to_tsvector('english', %s), 'idx_service_history_bm25'))::numeric, 4) AS bm25_score
        FROM public.service_history_search s
        ORDER BY s.summary_tsv <@> to_bm25query(to_tsvector('english', %s), 'idx_service_history_bm25')
        LIMIT %s
        """,
        (nl_query, nl_query, limit),
    )


def search_offers(nl_query: str, limit: int = 5) -> list[dict]:
    return query(
        """
        SELECT offer_id, offer_name, offer_type, value_usd, description,
               ROUND((description_tsv <@> to_bm25query(
                   to_tsvector('english', %s), 'idx_offer_search_bm25'))::numeric, 4) AS bm25_score
        FROM public.offer_search
        ORDER BY description_tsv <@> to_bm25query(to_tsvector('english', %s), 'idx_offer_search_bm25')
        LIMIT %s
        """,
        (nl_query, nl_query, limit),
    )
