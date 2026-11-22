import { Dialog } from '../../ui/dialogs';
import { el, setText } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { toast } from '../../ui/toast';

export class WebhookDialog extends Dialog {
  private readonly url = el<HTMLInputElement>('<input class="cv-input" type="text" readonly spellcheck="false">');
  private readonly header = el<HTMLInputElement>('<input class="cv-input" type="text" readonly spellcheck="false">');
  private readonly secret = el<HTMLInputElement>('<input class="cv-input" type="text" readonly spellcheck="false">');
  private readonly how = el('<p class="cv-note cv-tg-how"></p>');

  constructor() {
    super('Webhook', 520);
    this.field('Address', this.url);
    this.field('Header', this.header);
    this.field('Secret', this.secret);
    this.body.append(this.how);
    this.button('Copy secret', 'ghost', () => this.copy(this.secret.value));
    this.button('Copy address', 'ghost', () => this.copy(this.url.value));
    this.button('Close', 'primary', () => this.close());
  }

  show(path: string, header: string, secret: string): void {
    this.url.value = `${location.origin}${path}`;
    this.header.value = header;
    this.secret.value = secret;
    setText(this.how, t('Send a POST with three headers: X-FormSubstrate-Timestamp (unix seconds, within five minutes), X-FormSubstrate-Nonce (a fresh random string of 8 to 64 letters, digits, dashes or underscores, never reused) and X-FormSubstrate-Signature, which is sha256= and the HMAC-SHA256 of timestamp, a dot, the nonce, a dot and the raw body, keyed with the secret. A stale, repeated or unsigned request does not fire the trigger.'));
    if (!this.isOpen) this.open();
  }

  private copy(text: string): void {
    void navigator.clipboard.writeText(text).then(() => toast(t('Copied')), () => toast(t('Copy failed'), 'error'));
  }
}
