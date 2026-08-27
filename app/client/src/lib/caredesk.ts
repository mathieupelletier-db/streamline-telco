/**
 * REST helpers for the Care Desk domain — the at-risk subscriber queue, map,
 * activity feed, and subscriber detail drawer. Hits the /api/care/* routes
 * (server/routes/care.ts). TYPES live in shared/types.ts.
 */
import { okOrThrow } from './api';
import type {
  CareQueueRow,
  CareSummary,
  MetroBucket,
  CareActivity,
  SubscriberDetail,
  OfferType,
} from '@/shared/types';

export async function fetchCareQueue(
  filters: {
    riskBand?: string;
    churnReason?: string;
    metro?: string;
    actioned?: boolean;
    sort?: 'risk' | 'clv' | 'recent';
  } = {},
): Promise<CareQueueRow[]> {
  const qs = new URLSearchParams();
  if (filters.riskBand) qs.set('riskBand', filters.riskBand);
  if (filters.churnReason) qs.set('churnReason', filters.churnReason);
  if (filters.metro) qs.set('metro', filters.metro);
  if (filters.actioned !== undefined) qs.set('actioned', String(filters.actioned));
  if (filters.sort) qs.set('sort', filters.sort);
  const res = await okOrThrow(await fetch(`/api/care/queue?${qs}`), '/api/care/queue');
  return res.json();
}

export async function fetchCareSummary(): Promise<CareSummary> {
  const res = await okOrThrow(await fetch('/api/care/summary'), '/api/care/summary');
  return res.json();
}

export async function fetchCareMetros(): Promise<MetroBucket[]> {
  const res = await okOrThrow(await fetch('/api/care/metros'), '/api/care/metros');
  return res.json();
}

export async function fetchCareActivity(limit = 20): Promise<CareActivity[]> {
  const res = await okOrThrow(
    await fetch(`/api/care/activity?limit=${limit}`),
    '/api/care/activity',
  );
  return res.json();
}

export async function fetchSubscriber(id: string): Promise<SubscriberDetail> {
  const res = await okOrThrow(
    await fetch(`/api/care/subscribers/${encodeURIComponent(id)}`),
    `/api/care/subscribers/${id}`,
  );
  return res.json();
}

export async function decideSubscriber(
  id: string,
  args: {
    decision: 'approved' | 'declined';
    offerType: OfferType;
    offerId?: string | null;
    predictedRetainedClvUsd?: number | null;
    notes?: string;
  },
): Promise<{ ok: boolean; actionId: string }> {
  const res = await okOrThrow(
    await fetch(`/api/care/subscribers/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }),
    `/api/care/subscribers/${id}/decide`,
  );
  return res.json();
}
