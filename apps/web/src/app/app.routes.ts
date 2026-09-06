import { Routes } from '@angular/router';
import { ChatShell } from './chat/chat-shell';
import { BriefingShell } from './briefing/briefing-shell';
import { LoginShell } from './layout/login-shell';

export const routes: Routes = [
  { path: '', component: BriefingShell },
  { path: 'chat', component: ChatShell },
  { path: 'login', component: LoginShell },
  { path: '**', redirectTo: '' },
];
