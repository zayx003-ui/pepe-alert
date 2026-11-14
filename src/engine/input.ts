/**
 * Entrées clavier et souris → commandes de jeu.
 * Les touches sont lues par position physique et entièrement reconfigurables.
 */
import type { ActionId, Settings } from '../config/settings';
import { emptyInput, type FrameInput } from '../game/session';

export type UiAction = 'inventaire' | 'carte' | 'documents' | 'discussion' | 'radio' | 'menu';

export class InputManager {
  /** Rotation de la vue accumulée depuis la dernière lecture (radians). */
  lookX = 0;
  lookY = 0;
  locked = false;
  /** Pousser-pour-parler : voix de proximité / radio. */
  talk = false;
  talkRadio = false;
  onUiAction: (a: UiAction) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  /** Clic alors qu'aucune interface n'est ouverte et que la souris n'est pas capturée. */
  onWantLock: () => void = () => {};
  private down = new Set<string>();
  private pressed = new Set<ActionId>();
  private mouse = [false, false, false];
  private mousePressed = [false, false, false];
  private wheel = 0;
  private slot = -1;
  private byCode = new Map<string, ActionId>();
  private input = emptyInput();
  private disposers: (() => void)[] = [];
  /** Lissage du mouvement de souris lorsque l'entrée brute est désactivée. */
  private smoothX = 0;
  private smoothY = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: Settings,
  ) {
    this.rebind();
    const on = <K extends keyof DocumentEventMap>(target: Document | HTMLElement | Window, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(document, 'keydown', (e) => this.onKey(e, true));
    on(document, 'keyup', (e) => this.onKey(e, false));
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const k = 0.0022 * this.settings.sensitivity;
      this.lookX += e.movementX * k;
      this.lookY += e.movementY * k * (this.settings.invertY ? -1 : 1);
    });
    on(canvas, 'pointerdown', (e) => {
      if (!this.locked) {
        this.onWantLock();
        return;
      }
      if (e.button < 3) {
        this.mouse[e.button] = true;
        this.mousePressed[e.button] = true;
      }
      e.preventDefault();
    });
    on(document, 'pointerup', (e) => {
      if (e.button < 3) this.mouse[e.button] = false;
    });
    on(canvas, 'wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.releaseAll();
      this.onLockChange(this.locked);
    });
    on(window as unknown as Document, 'blur' as keyof DocumentEventMap, () => this.releaseAll());
  }

  rebind(): void {
    this.byCode.clear();
    for (const [action, code] of Object.entries(this.settings.keys) as [ActionId, string][]) this.byCode.set(code, action);
  }

  /** Capture la souris. L'entrée brute contourne l'accélération du système quand le navigateur le permet. */
  lock(): void {
    if (this.locked) return;
    const request = this.canvas.requestPointerLock as (opts?: { unadjustedMovement: boolean }) => Promise<void> | void;
    try {
      const result = request.call(this.canvas, this.settings.rawInput ? { unadjustedMovement: true } : undefined);
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          // Entrée brute refusée par la plateforme : capture classique.
          try {
            void this.canvas.requestPointerLock();
          } catch {
            /* la capture exige un geste de l'utilisateur ; le prochain clic réessaiera */
          }
        });
      }
    } catch {
      /* idem */
    }
  }

  unlock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private releaseAll(): void {
    this.down.clear();
    this.mouse.fill(false);
    this.talk = false;
    this.talkRadio = false;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    if (e.code === 'Escape') {
      if (down && !e.repeat && !typing) this.onUiAction('menu');
      return;
    }
    if (typing) return;
    const action = this.byCode.get(e.code);
    if (this.locked) {
      // En jeu, aucune touche ne doit déclencher un raccourci du navigateur.
      if (action || e.code.startsWith('Digit') || e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (down) {
        if (!e.repeat) {
          this.down.add(e.code);
          if (action) this.pressed.add(action);
          if (e.code.startsWith('Digit')) {
            const n = Number(e.code.slice(5));
            if (n >= 1 && n <= 8) this.slot = n - 1;
          }
        }
      } else this.down.delete(e.code);
      if (action === 'parler') this.talk = down;
      if (action === 'radio') this.talkRadio = down;
    } else if (!down) this.down.delete(e.code);
    if (down && !e.repeat && action) {
      if (action === 'inventaire' || action === 'carte' || action === 'documents' || action === 'discussion') {
        e.preventDefault();
        this.onUiAction(action);
      } else if (action === 'radio' && this.locked) this.onUiAction('radio');
    }
  }

  private held(action: ActionId): boolean {
    return this.down.has(this.settings.keys[action]);
  }

  /** Applique la rotation de vue accumulée ; renvoie le mouvement effectivement consommé. */
  consumeLook(dt: number): { x: number; y: number } {
    let x = this.lookX;
    let y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    if (!this.settings.rawInput) {
      // Léger lissage quand l'accélération du système est conservée.
      const k = Math.min(1, dt * 30);
      this.smoothX += (x - this.smoothX) * k;
      this.smoothY += (y - this.smoothY) * k;
      x = this.smoothX;
      y = this.smoothY;
    }
    return { x, y };
  }

  /** Commandes de l'image courante. Les fronts montants sont remis à zéro après lecture. */
  sample(frozen: boolean): FrameInput {
    const i = this.input;
    const active = this.locked && !frozen;
    i.forward = active ? (this.held('avancer') ? 1 : 0) - (this.held('reculer') ? 1 : 0) : 0;
    i.strafe = active ? (this.held('droite') ? 1 : 0) - (this.held('gauche') ? 1 : 0) : 0;
    i.sprint = active && this.held('courir');
    // Seconde touche d'accroupissement fixe : Ctrl + Z ferme l'onglet sur certains navigateurs.
    i.crouch = active && (this.held('accroupir') || this.down.has('KeyC'));
    i.jump = active && this.held('sauter');
    i.holdBreath = active && this.held('apnee');
    i.interact = active && this.held('interagir');
    i.interactPressed = active && this.pressed.has('interagir');
    i.scroll = active ? this.wheel : 0;
    i.use = active && this.mouse[0]!;
    i.usePressed = active && this.mousePressed[0]!;
    i.throwPressed = active && this.mousePressed[2]!;
    i.dropPressed = active && this.pressed.has('lacher');
    i.reloadPressed = active && this.pressed.has('recharger');
    i.lightPressed = active && this.pressed.has('lampe');
    i.slot = active ? this.slot : -1;
    i.frozen = !active;
    this.pressed.clear();
    this.mousePressed.fill(false);
    this.wheel = 0;
    this.slot = -1;
    return i;
  }

  dispose(): void {
    this.unlock();
    for (const d of this.disposers) d();
  }
}
