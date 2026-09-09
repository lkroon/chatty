import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, from } from 'rxjs';
import type { Briefing, BriefingItems, GoogleConnectionStatus } from '@contracts';

import { clearBriefingCache } from '../core/briefing-cache';
import { BriefingApi } from './briefing-api';

/**
 * `fetch`-based, matching core/real-chat-api.ts — this app deliberately
 * doesn't register `provideHttpClient`.
 */
@Injectable()
export class RealBriefingApi implements BriefingApi {
  private readonly router = inject(Router);

  getBriefing(): Observable<Briefing> {
    return from(this.getJson<Briefing>('/api/briefing'));
  }

  getBriefingItems(): Observable<BriefingItems> {
    return from(this.getJson<BriefingItems>('/api/briefing/items'));
  }

  completeTask(id: string): Observable<void> {
    return from(
      this.request(`/api/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' }).then(
        () => undefined,
      ),
    );
  }

  markMailRead(id: string): Observable<void> {
    return this.mailAction(id, 'read');
  }

  archiveMail(id: string): Observable<void> {
    return this.mailAction(id, 'archive');
  }

  private mailAction(id: string, action: 'read' | 'archive'): Observable<void> {
    return from(
      this.request(`/api/mail/${encodeURIComponent(id)}/${action}`, { method: 'POST' }).then(
        () => undefined,
      ),
    );
  }

  getGoogleStatus(): Observable<GoogleConnectionStatus> {
    return from(this.getJson<GoogleConnectionStatus>('/api/google/status'));
  }

  disconnectGoogle(): Observable<void> {
    return from(
      this.request('/api/google/connection', { method: 'DELETE' }).then(() => {
        clearBriefingCache();
        return undefined;
      }),
    );
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(path, init);
    if (response.status === 401 || response.status === 403) {
      // Senders and subjects must not survive a session that has ended.
      clearBriefingCache();
      void this.router.navigateByUrl('/login');
      throw new Error(`authentication required (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`request to ${path} failed (${response.status})`);
    }
    return response;
  }

  private async getJson<T>(path: string): Promise<T> {
    return (await (await this.request(path)).json()) as T;
  }
}
