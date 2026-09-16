import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import type { Briefing, BriefingItems, GoogleConnectionStatus } from '@contracts';

/** Everything the Today screen needs from the backend. */
export interface BriefingApi {
  /** Items plus the model-written summary. Costs a model call — Refresh only. */
  getBriefing(): Observable<Briefing>;
  /** Items only. The polling path; safe to call on every focus. */
  getBriefingItems(): Observable<BriefingItems>;
  /**
   * Marks one Google task complete. Idempotent.
   *
   * Takes the list too: a task id is only unique within its list, so this is
   * the one call that cannot be made from the id alone.
   */
  completeTask(id: string, listId: string): Observable<void>;
  /** Removes the UNREAD label. Idempotent. */
  markMailRead(id: string): Observable<void>;
  /** Removes INBOX and UNREAD — Gmail's own archive. Idempotent. */
  archiveMail(id: string): Observable<void>;
  getGoogleStatus(): Observable<GoogleConnectionStatus>;
  disconnectGoogle(): Observable<void>;
}

export const BRIEFING_API = new InjectionToken<BriefingApi>('BRIEFING_API');
