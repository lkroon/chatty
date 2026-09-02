import { Routes } from '@angular/router';
import { ChatShell } from './chat/chat-shell';
import { LoginShell } from './layout/login-shell';

export const routes: Routes = [
  { path: '', component: ChatShell },
  { path: 'login', component: LoginShell },
  { path: '**', redirectTo: '' },
];
