/**
 * Streamline Telco Care Desk routes — the read/write surface for the
 * Operations page + Home activity feed.
 *
 *   GET  /api/care/queue            — at-risk subscriber queue (filters/sort)
 *   GET  /api/care/summary          — KPI counts (at-risk by band, saves)
 *   GET  /api/care/metros           — per-metro buckets for the map
 *   GET  /api/care/activity         — recent care actions (Home feed)
 *   GET  /api/care/subscribers/:id  — full subscriber detail (drawer)
 *   POST /api/care/subscribers/:id/decide — record a care-lead decision
 *
 * Reads hit the synced read-only mirrors; the only write is decideCareAction →
 * app.care_actions (mirrors the agent's execute_retention_action path). The
 * agent + this UI both feed the same writable table, so the queue reflects
 * writes from either source.
 */
import type { Application } from 'express';
import express from 'express';
import {
  listCareQueue,
  careSummary,
  metroBuckets,
  recentActivity,
  subscriberDetail,
  decideCareAction,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { AppDb } from '../db/index.js';

const RISK_BANDS = new Set(['critical', 'elevated', 'watch', 'healthy']);
const OFFER_TYPES = new Set(['bill_credit', 'plan_upgrade_discount', 'device_upgrade']);

export function registerCareRoutes(app: Application, deps: { db: AppDb }): void {
  const { db } = deps;

  // GET /api/care/queue — the at-risk subscriber queue.
  app.get('/api/care/queue', async (req, res) => {
    const q = req.query;
    const riskBand = typeof q.riskBand === 'string' && RISK_BANDS.has(q.riskBand) ? q.riskBand : undefined;
    const churnReason = typeof q.churnReason === 'string' ? q.churnReason : undefined;
    const metro = typeof q.metro === 'string' ? q.metro : undefined;
    const actioned =
      q.actioned === 'true' ? true : q.actioned === 'false' ? false : undefined;
    const sort =
      q.sort === 'clv' || q.sort === 'recent' || q.sort === 'risk' ? q.sort : undefined;
    const rows = await listCareQueue(db, { riskBand, churnReason, metro, actioned, sort });
    res.json(rows);
  });

  // GET /api/care/summary — KPI counts.
  app.get('/api/care/summary', async (_req, res) => {
    res.json(await careSummary(db));
  });

  // GET /api/care/metros — per-metro map buckets.
  app.get('/api/care/metros', async (_req, res) => {
    res.json(await metroBuckets(db));
  });

  // GET /api/care/activity — recent care actions for the Home feed.
  app.get('/api/care/activity', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    res.json(await recentActivity(db, limit));
  });

  // GET /api/care/subscribers/:id — full detail for the drawer.
  app.get('/api/care/subscribers/:id', async (req, res) => {
    const detail = await subscriberDetail(db, req.params.id);
    if (!detail) {
      res.status(404).json({ error: `Unknown subscriber: ${req.params.id}` });
      return;
    }
    res.json(detail);
  });

  // POST /api/care/subscribers/:id/decide — care lead approves/declines an offer.
  app.post('/api/care/subscribers/:id/decide', express.json(), async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const decision = req.body?.decision as 'approved' | 'declined' | undefined;
    const offerType = req.body?.offerType as string | undefined;
    if (decision !== 'approved' && decision !== 'declined') {
      res.status(400).json({ error: 'decision must be "approved" or "declined"' });
      return;
    }
    if (!offerType || !OFFER_TYPES.has(offerType)) {
      res.status(400).json({ error: 'offerType must be bill_credit / plan_upgrade_discount / device_upgrade' });
      return;
    }
    const { actionId } = await decideCareAction(db, {
      subscriberId: req.params.id,
      decision,
      offerType: offerType as 'bill_credit' | 'plan_upgrade_discount' | 'device_upgrade',
      offerId: (req.body?.offerId as string | undefined) ?? null,
      predictedRetainedClvUsd: (req.body?.predictedRetainedClvUsd as number | undefined) ?? null,
      notes: req.body?.notes as string | undefined,
      userEmail,
    });
    res.json({ ok: true, actionId });
  });
}
