import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { CHAT_API } from '../core/chat-api';
import { ChatStore } from '../core/chat-store';
import { RealChatApi } from '../core/real-chat-api';
import { ChattyLogo } from '../shared/chatty-logo';
import { TodayChatSwitch } from '../shared/today-chat-switch';
import { Composer } from './composer';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { ModelPicker } from './model-picker';
import { PendingRail } from './pending-rail';

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
  imports: [
    ModelPicker,
    ConversationList,
    MessageThread,
    Composer,
    ChattyLogo,
    TodayChatSwitch,
    PendingRail,
  ],
  providers: [{ provide: CHAT_API, useClass: RealChatApi }, ChatStore],
  templateUrl: './chat-shell.html',
  styleUrl: './chat-shell.scss',
})
export class ChatShell {
  protected readonly store = inject(ChatStore);
  protected readonly sidebarOpen = signal(false);

  constructor() {
    // Arriving from Today's "Review": open that conversation, then scroll to
    // the card once its messages are on screen. Reading the snapshot rather
    // than subscribing is deliberate — this is a one-shot entry, and a live
    // subscription would re-scroll every time the URL changed for any reason.
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const conversationId = params.get('conversation');
    const proposalId = params.get('proposal');
    if (conversationId) {
      this.store.selectConversation(conversationId);
    }
    if (proposalId) {
      // The messages arrive asynchronously; scroll on the first render that
      // actually contains the card, then stop looking.
      const stop = effect(() => {
        if (!this.store.messages().length) {
          return;
        }
        // afterNextRender would be cleaner, but the card is rendered by a
        // signal read inside this same effect's tick.
        setTimeout(() => {
          document
            .getElementById(`proposal-${proposalId}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        stop.destroy();
      });
    }
  }
}
