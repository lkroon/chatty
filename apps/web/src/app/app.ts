import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ViewportFit } from './core/viewport-fit';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('web');

  // Injected purely for its side effect: it starts publishing the visual
  // viewport's size to <html> as CSS custom properties, which every screen's
  // layout is measured against. See core/viewport-fit.ts.
  private readonly viewportFit = inject(ViewportFit);
}
