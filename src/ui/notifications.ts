export type ToastKind = 'info' | 'success' | 'warn';

export class NotificationService {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  toast(title: string, detail = '', kind: ToastKind = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.setAttribute('role', 'status');

    const titleEl = document.createElement('div');
    titleEl.className = 'toast__title';
    titleEl.textContent = title;
    el.appendChild(titleEl);

    if (detail) {
      const detailEl = document.createElement('div');
      detailEl.className = 'toast__detail';
      detailEl.textContent = detail;
      el.appendChild(detailEl);
    }

    this.container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));

    window.setTimeout(() => {
      el.classList.remove('is-visible');
      window.setTimeout(() => el.remove(), 260);
    }, 3800);
  }

  async requestDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    if (Notification.permission === 'granted') return 'granted';
    return Notification.requestPermission();
  }

  sendDesktopNotification(enabled: boolean, title: string, body: string): void {
    if (!enabled) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      new Notification(title, { body, silent: true });
    } catch {
      // Ignore browser notification restrictions
    }
  }
}
