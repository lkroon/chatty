import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import type { Briefing, GoogleConnectionStatus } from '@contracts';

/** Everything the Today screen needs from the backend. */
export interface BriefingApi {
  getBriefing(): Observable<Briefing>;
  getGoogleStatus(): Observable<GoogleConnectionStatus>;
  disconnectGoogle(): Observable<void>;
}

export const BRIEFING_API = new InjectionToken<BriefingApi>('BRIEFING_API');
