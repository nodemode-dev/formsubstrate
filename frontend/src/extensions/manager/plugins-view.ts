import { library, type PluginInfo, type PluginSettings } from '../../io/library';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { onLanguage, t, tn } from '../../ui/i18n';
import { toast } from '../../ui/toast';
import { fail, setToggle, toggle, toolsChanged, type Toggle } from './parts';

interface Refs {
  name: HTMLElement;
  version: HTMLElement;
  origin: HTMLElement;
  status: HTMLElement;
  gear: HTMLButtonElement;
  form: HTMLElement;
  fields: HTMLElement;
  tg: Toggle;
  info: PluginInfo;
  built: boolean;
}

export class PluginsView {
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly reloadBtn: HTMLButtonElement;
  private readonly refs = new WeakMap<HTMLElement, Refs>();
  private plugins: PluginInfo[] = [];
  private busy = false;
  private loaded = false;

  constructor(host: HTMLElement) {
    host.append(el(
      '<div class="cv-lib-pane">' +
      `<div class="cv-lib-bar"><span class="cv-lib-count"></span><button class="cv-wb-tool cv-lib-reload" type="button">${icon('refresh', 14)}</button></div>` +
      '<div class="cv-lib-list" role="list"></div>' +
      '<p class="cv-note cv-lib-empty" hidden></p></div>'));
    this.count = q(host, '.cv-lib-count');
    this.list = q(host, '.cv-lib-list');
    this.empty = q(host, '.cv-lib-empty');
    this.reloadBtn = q(host, '.cv-lib-reload');
    this.reloadBtn.addEventListener('click', () => void this.run(() => library.reloadPlugins(), 'Plugins reloaded'));
    onLanguage(() => { this.relabel(); this.render(); });
    this.relabel();
  }

  private relabel(): void {
    setTitle(this.reloadBtn, t('Reload plugins'));
    this.reloadBtn.setAttribute('aria-label', t('Reload plugins'));
  }

  async refresh(): Promise<void> {
    try {
      this.plugins = (await library.plugins()).plugins;
    } catch {
      this.plugins = [];
    }
    this.loaded = true;
    this.render();
  }

  private async run(call: () => Promise<{ plugins: PluginInfo[] }>, done?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.plugins = (await call()).plugins;
      if (done) toast(t(done));
    } catch (err) {
      fail(err, 'Plugin action failed');
    } finally {
      this.busy = false;
      this.render();
      toolsChanged();
    }
  }

  render(): void {
    patchList(this.list, this.plugins, {
      key: (p) => `${p.origin}:${p.name}`,
      create: (p) => this.create(p),
      update: (node, p) => this.update(node, p),
    });
    setText(this.count, tn(this.plugins.length, '{n} plugin', '{n} plugins'));
    setHidden(this.empty, this.plugins.length > 0 || !this.loaded);
    setText(this.empty, t('No plugins. Put .py files in .formsubstrate/plugins/ in the workspace.'));
  }

  private create(info: PluginInfo): HTMLElement {
    const node = el(
      '<div class="cv-lib-block" role="listitem"><div class="cv-lib-row cv-lib-plg">' +
      '<div class="cv-lib-main"><div class="cv-lib-top"><span class="cv-lib-name"></span><span class="cv-lib-chip cv-lib-ver"></span><span class="cv-lib-chip cv-lib-origin"></span></div>' +
      '<div class="cv-lib-desc cv-lib-status"></div></div>' +
      `<button class="cv-wb-tool cv-lib-gear" type="button" hidden>${icon('settings', 14)}</button></div>` +
      '<div class="cv-lib-form" hidden><div class="cv-lib-fields"></div>' +
      '<div class="cv-lib-formbar"><button class="cv-lib-btn cv-lib-save" type="button"></button></div></div></div>');
    const row = q(node, '.cv-lib-row');
    const tg = toggle(info.name);
    row.append(tg.root);
    const refs: Refs = { name: q(node, '.cv-lib-name'), version: q(node, '.cv-lib-ver'), origin: q(node, '.cv-lib-origin'), status: q(node, '.cv-lib-status'), gear: q(node, '.cv-lib-gear'), form: q(node, '.cv-lib-form'), fields: q(node, '.cv-lib-fields'), tg, info, built: false };
    this.refs.set(node, refs);
    tg.input.addEventListener('change', () => void this.run(() => library.enablePlugin(refs.info.name, tg.input.checked)));
    refs.gear.addEventListener('click', () => void this.toggleForm(refs));
    q(node, '.cv-lib-save').addEventListener('click', () => void this.save(refs));
    this.update(node, info);
    return node;
  }

  private update(node: HTMLElement, info: PluginInfo): void {
    const refs = this.refs.get(node);
    if (!refs) return;
    refs.info = info;
    setText(refs.name, info.name);
    setText(refs.version, info.version ? `v${info.version}` : '');
    setHidden(refs.version, !info.version);
    setText(refs.origin, t(info.origin === 'bundled' ? 'Bundled' : 'Workspace'));
    const status = info.error ? info.error.split('\n').filter(Boolean).pop() ?? info.error : info.held ? t(info.held) : !info.enabled ? t('Disabled') : `${info.description ? `${info.description} · ` : ''}${tn(info.tools.length, '{n} tool', '{n} tools')}`;
    setText(refs.status, status);
    setTitle(refs.status, info.error ?? info.tools.join(', '));
    setClass(node, 'is-error', !!info.error);
    setClass(node, 'is-off', !info.enabled);
    setHidden(refs.gear, info.settings_schema.length === 0 || !info.loaded);
    setToggle(refs.tg, info.enabled, !!info.held, info.held ? t(info.held) : `${t(info.enabled ? 'Disable' : 'Enable')} ${info.name}`);
    refs.gear.setAttribute('aria-label', t('Settings'));
    setTitle(refs.gear, t('Settings'));
    setText(q(node, '.cv-lib-save'), t('Save and reload'));
  }

  private async toggleForm(refs: Refs): Promise<void> {
    if (!refs.form.hidden) {
      setHidden(refs.form, true);
      return;
    }
    try {
      const s = await library.pluginSettings(refs.info.name);
      this.fill(refs, s);
      setHidden(refs.form, false);
    } catch (err) {
      fail(err, 'Could not load settings');
    }
  }

  private fill(refs: Refs, s: PluginSettings): void {
    if (!refs.built) {
      refs.built = true;
      for (const spec of s.schema) {
        const label = el(`<label class="cv-lib-field"><span class="cv-lib-flabel"></span><input class="cv-input" data-name="${spec.name}" spellcheck="false" autocomplete="off"></label>`);
        const input = q<HTMLInputElement>(label, 'input');
        input.type = spec.secret ? 'password' : 'text';
        setText(q(label, '.cv-lib-flabel'), spec.label ?? spec.name);
        refs.fields.append(label);
      }
    }
    for (const input of Array.from(refs.fields.querySelectorAll<HTMLInputElement>('input'))) {
      const name = input.dataset.name ?? '';
      const spec = s.schema.find((x) => x.name === name);
      input.value = s.values[name] ?? '';
      input.placeholder = spec?.secret ? (s.secret_set[name] ? t('Stored in the system keyring; type to replace') : t('Stored in the system keyring')) : spec?.placeholder ?? '';
    }
  }

  private async save(refs: Refs): Promise<void> {
    const values: Record<string, string> = {};
    for (const input of Array.from(refs.fields.querySelectorAll<HTMLInputElement>('input'))) values[input.dataset.name ?? ''] = input.value;
    try {
      const out = await library.savePluginSettings(refs.info.name, values);
      this.plugins = out.plugins;
      this.fill(refs, out.settings);
      setHidden(refs.form, true);
      toast(`${refs.info.name}: ${t('settings saved and plugin reloaded')}`);
      this.render();
      toolsChanged();
    } catch (err) {
      fail(err, 'Could not save settings');
    }
  }
}
