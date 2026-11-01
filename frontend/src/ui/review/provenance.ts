import { formslotState } from '../../io/formslot';
import { setHidden, setText, setTitle } from '../dom';
import { t } from '../i18n';

const STATE_LABEL: Record<string, string> = {
  clean: 'in sync',
  local: 'edited here',
  behind: 'slot has changed',
  diverged: 'diverged',
  missing: 'missing',
};

export const PROVENANCE_HTML = '<span class="cv-fs-prov" hidden></span>';

export function paintProvenance(badge: HTMLElement, path: string): void {
  const d = formslotState.isEnabled ? formslotState.driftFor(path) : undefined;
  setHidden(badge, !d);
  if (!d) return;
  const label = t(STATE_LABEL[d.state] ?? d.state);
  setText(badge, `${t('slot')} ${d.slot} · ${label}`);
  setTitle(badge, `${t('This file is a copy of the slot')} ${d.slot}: ${label}`);
  if (badge.dataset.state !== d.state) badge.dataset.state = d.state;
}
