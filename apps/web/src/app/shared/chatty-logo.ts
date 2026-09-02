import { Component, input } from '@angular/core';

/**
 * The Chatty mark: two overlapping speech bubbles (mint behind, coral in
 * front with the tail) — reused wherever the brand needs an icon rather
 * than just the wordmark (the header and the sign-in screen).
 */
@Component({
  selector: 'app-chatty-logo',
  imports: [],
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="10" y="4" width="18" height="14" rx="7" fill="#bfe3d3" />
      <rect x="2" y="10" width="20" height="15" rx="7.5" fill="#ff6f59" />
      <path d="M8 25 L8 30 L14 25 Z" fill="#ff6f59" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
      flex-shrink: 0;
    }
  `,
})
export class ChattyLogo {
  readonly size = input(24);
}
