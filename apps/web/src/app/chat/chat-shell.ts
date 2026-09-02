import { Component, signal } from '@angular/core';

import { CHAT_API } from '../core/chat-api';
import { ChatStore } from '../core/chat-store';
import { RealChatApi } from '../core/real-chat-api';
import { ChattyLogo } from '../shared/chatty-logo';
import { Composer } from './composer';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { ModelPicker } from './model-picker';

/**
 * Root chat feature component. Wires up the `CHAT_API` DI token and the
 * `ChatStore` at this component's level (see `core/chat-store.ts` for why
 * it can't be `providedIn: 'root'`).
 *
 * The API port is bound to the real backend here so the store and all child
 * components use the same implementation.
 */
@Component({
  selector: 'app-chat-shell',
  imports: [ModelPicker, ConversationList, MessageThread, Composer, ChattyLogo],
  providers: [{ provide: CHAT_API, useClass: RealChatApi }, ChatStore],
  templateUrl: './chat-shell.html',
  styleUrl: './chat-shell.scss',
})
export class ChatShell {
  protected readonly sidebarOpen = signal(false);
}
