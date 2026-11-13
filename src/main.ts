import { App } from './ui/app';

const app = new App();
app.start().catch((err) => {
  // Une erreur au démarrage doit être visible : pas d'écran noir silencieux.
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;font-family:monospace;color:#e0796a;text-align:center';
    box.textContent = `NOCTURNE n'a pas pu démarrer : ${err instanceof Error ? err.message : String(err)}`;
    ui.append(box);
  }
});
