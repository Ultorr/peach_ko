/* YouTube 字幕列表与选项层级；本地文件和中文搜索接入同一条 TextTrack。 */
import { api, esc, icon } from '@peach/legacy/core';
import { setActionBusy, spinnerHtml } from '@peach/legacy/ui';
import { CAPTION_OPTIONS, mountCaptionStyle, type CaptionKey } from './subtitle-style';
import type { VjsPlayer } from './types';

interface Panels {
  render(html: string, direction: number): HTMLElement;
  open(): void;
  close(): void;
  back(): void;
}
interface SearchResult { id: string; title: string; language: string; format: string }
interface SubtitleFile { index: number; name: string; playable: boolean; language: string }

/** YouTube f572e43c 的 b$f：矩形实底与镂空 CC，使用原始 36 单位视框。 */
export const subtitleIcon = () => '<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M11,11 C9.89,11 9,11.9 9,13 L9,23 C9,24.1 9.89,25 11,25 L25,25 C26.1,25 27,24.1 27,23 L27,13 C27,11.9 26.1,11 25,11 L11,11 Z M17,17 L15.5,17 L15.5,16.5 L13.5,16.5 L13.5,19.5 L15.5,19.5 L15.5,19 L17,19 L17,20 C17,20.55 16.55,21 16,21 L13,21 C12.45,21 12,20.55 12,20 L12,16 C12,15.45 12.45,15 13,15 L16,15 C16.55,15 17,15.45 17,16 L17,17 L17,17 Z M24,17 L22.5,17 L22.5,16.5 L20.5,16.5 L20.5,19.5 L22.5,19.5 L22.5,19 L24,19 L24,20 C24,20.55 23.55,21 23,21 L20,21 C19.45,21 19,20.55 19,20 L19,16 C19,15.45 19.45,15 20,15 L23,15 C23.55,15 24,15.45 24,16 L24,17 L24,17 Z"/></svg>';

export class SubtitleControls {
  private cleanup = new AbortController();
  private request: AbortController | null = null;
  private imported = new Map<string, { node: HTMLTrackElement; url: string }>();
  private last: TextTrack | null = null;
  private page = '';
  private generation = 0;
  private styles;
  private input = document.createElement('input');
  private cc: HTMLButtonElement;
  private query = '';
  private offset = 0;
  private results: SearchResult[] = [];
  private more = false;
  private searched = false;

  constructor(private player: VjsPlayer, private video: HTMLVideoElement, private panels: Panels) {
    this.styles = mountCaptionStyle(player.el(), video, this.cleanup.signal);
    this.cc = player.el().querySelector<HTMLButtonElement>('.vjs-subtitles-control > button')!;
    this.cc.innerHTML = subtitleIcon();
    this.cc.onclick = () => {
      const showing = this.tracks().find(track => track.mode === 'showing');
      if (showing) { this.last = showing; this.select(null) }
      else if (this.tracks().length) this.select(this.last && this.tracks().includes(this.last) ? this.last : this.tracks()[0]!);
      else this.show();
    };
    this.input.type = 'file'; this.input.accept = '.srt,.ass,.ssa,.vtt'; this.input.hidden = true;
    this.input.setAttribute('aria-label', "자막 파일 불러오기"); player.el().append(this.input);
    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0]; this.input.value = '';
      if (file) void this.importFile(file);
    }, { signal: this.cleanup.signal });
    video.textTracks.addEventListener('change', () => this.sync(), { signal: this.cleanup.signal });
    video.textTracks.addEventListener('addtrack', () => { this.sync(); if (this.page === 'tracks') this.show(0) }, { signal: this.cleanup.signal });
    video.textTracks.addEventListener('removetrack', () => { this.sync(); if (this.page === 'tracks') this.show(0) }, { signal: this.cleanup.signal });
    player.on('dispose', () => {
      this.hide(); this.cleanup.abort();
      this.imported.forEach(({ url }) => URL.revokeObjectURL(url)); this.imported.clear();
    });
    this.sync();
  }

  private tracks() { return [...this.video.textTracks].filter(track => ['subtitles', 'captions'].includes(track.kind)) }
  label() { return this.tracks().find(track => track.mode === 'showing')?.label || "꺼짐" }
  hide() { this.request?.abort(); this.page = ''; this.generation++ }
  private sync() {
    const active = this.tracks().find(track => track.mode === 'showing');
    this.cc.setAttribute('aria-pressed', String(!!active));
    this.cc.setAttribute('aria-label', active ? "자막 끄기" : "자막 켜기");
    if (active) this.last = active;
  }
  private select(track: TextTrack | null) {
    this.tracks().forEach(current => { current.mode = current === track ? 'showing' : 'disabled' });
    this.sync();
  }
  private header(title: string, extra = '') {
    return `<div class="vjs-peach-panel-header"><button type="button" class="vjs-peach-menu-back" data-subtitle-back aria-label="이전 메뉴로 돌아가기">${icon('player-menu-back')}</button><strong>${esc(title)}</strong>${extra}</div>`;
  }
  private panel(html: string, back: () => void, direction = 1) {
    this.generation++; this.panels.open();
    const panel = this.panels.render(html, direction);
    panel.querySelector<HTMLButtonElement>('[data-subtitle-back]')!.onclick = back;
    return panel;
  }

  show(direction = 1) {
    this.page = 'tracks';
    const tracks = this.tracks();
    const choices = [null, ...tracks];
    const panel = this.panel(this.header("자막", `<button type="button" class="vjs-peach-caption-options" data-subtitle-options aria-label="자막 옵션">${icon('settings')}</button>`) +
      `<div class="vjs-peach-panel-menu">${choices.map((track, index) => {
        const selected = track ? track.mode === 'showing' : tracks.every(row => row.mode !== 'showing');
        return `<button type="button" class="vjs-peach-menu-option" role="menuitemradio" aria-checked="${selected}" data-subtitle-track="${index}"><span class="vjs-peach-option-check">${selected ? icon('check') : ''}</span><span class="vjs-peach-option-label">${esc(track?.label || track?.language || (track ? "자막" : "꺼짐"))}</span></button>`;
      }).join('')}<button type="button" class="vjs-peach-caption-action" data-subtitle-file>자막 파일 불러오기</button><button type="button" class="vjs-peach-caption-action" data-subtitle-search>온라인 자막 검색</button></div><p class="vjs-peach-subtitle-status" data-subtitle-status role="status" hidden></p>`, () => { this.page = ''; this.panels.back() }, direction);
    panel.querySelector<HTMLButtonElement>('[data-subtitle-options]')!.onclick = () => this.options();
    panel.querySelector<HTMLButtonElement>('[data-subtitle-file]')!.onclick = () => this.input.click();
    panel.querySelector<HTMLButtonElement>('[data-subtitle-search]')!.onclick = () => { void this.searchPanel() };
    panel.querySelectorAll<HTMLButtonElement>('[data-subtitle-track]').forEach(button => {
      button.onclick = () => { this.select(choices[Number(button.dataset.subtitleTrack)]!); this.show(0) };
    });
  }

  private options(direction = 1) {
    this.page = 'options';
    const current = this.styles.current();
    const panel = this.panel(this.header("자막 옵션") + `<div class="vjs-peach-panel-menu">${Object.entries(CAPTION_OPTIONS).map(([key, option]) => {
      const label = option.values.find(([value]) => value === current[key as CaptionKey])?.[1] || '';
      return `<button type="button" class="vjs-peach-caption-setting" data-subtitle-style="${key}"><span>${esc(option.label)}</span><b>${esc(label)}</b>${icon('player-menu-next')}</button>`;
    }).join('')}<button type="button" class="vjs-peach-caption-action" data-subtitle-reset>초기화</button></div>`, () => this.show(-1), direction);
    panel.querySelectorAll<HTMLButtonElement>('[data-subtitle-style]').forEach(button => {
      button.onclick = () => this.styleOptions(button.dataset.subtitleStyle as CaptionKey);
    });
    panel.querySelector<HTMLButtonElement>('[data-subtitle-reset]')!.onclick = () => { this.styles.reset(); this.options(0) };
  }

  private styleOptions(key: CaptionKey) {
    this.page = 'style';
    const option = CAPTION_OPTIONS[key];
    const panel = this.panel(this.header(option.label) + `<div class="vjs-peach-panel-menu">${option.values.map(([value, label]) => {
      const selected = this.styles.current()[key] === value;
      return `<button type="button" class="vjs-peach-menu-option" role="menuitemradio" aria-checked="${selected}" data-subtitle-value="${esc(value!)}"><span class="vjs-peach-option-check">${selected ? icon('check') : ''}</span><span class="vjs-peach-option-label">${esc(label!)}</span></button>`;
    }).join('')}</div>`, () => this.options(-1));
    panel.querySelectorAll<HTMLButtonElement>('[data-subtitle-value]').forEach(button => {
      button.onclick = () => { this.styles.set(key, button.dataset.subtitleValue!); this.options(-1) };
    });
  }

  private status(message: string, error = false, busy = false) {
    const target = this.player.el().querySelector<HTMLElement>('.vjs-peach-panel:not(.vjs-peach-panel-leaving) [data-subtitle-status]');
    if (target) { target.hidden = false; target.innerHTML = `${busy ? spinnerHtml('') : ''}<span>${esc(message)}</span>`; target.toggleAttribute('data-error', error) }
  }
  private busy() { this.request?.abort(); this.request = new AbortController(); return this.request.signal }
  private async text(response: Response) {
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || "자막을 불러오지 못했습니다");
    }
    return response.text();
  }
  private async attach(text: string, name: string, key: string, signal: AbortSignal) {
    const existing = this.imported.get(key);
    if (existing) { this.select(existing.node.track); return }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
    const node = document.createElement('track'); node.kind = 'subtitles'; node.label = name; node.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error("자막 로딩 시간이 초과되었습니다. 다시 시도하세요")), 15_000);
        const finish = (error?: Error) => {
          clearTimeout(timer); node.removeEventListener('load', loaded); node.removeEventListener('error', failed); signal.removeEventListener('abort', aborted);
          if (error) reject(error); else resolve();
        };
        const loaded = () => finish(), failed = () => finish(new Error("자막 타임라인을 읽을 수 없습니다"));
        const aborted = () => finish(new DOMException("자막 로딩을 취소했습니다", 'AbortError'));
        node.addEventListener('load', loaded); node.addEventListener('error', failed); signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) { aborted(); return }
        this.video.append(node); node.track.mode = 'hidden';
      });
      if (signal.aborted || this.player.isDisposed()) throw new DOMException("자막 로딩을 취소했습니다", 'AbortError');
      this.imported.set(key, { node, url }); this.select(node.track);
    } catch (error) { node.remove(); URL.revokeObjectURL(url); throw error }
  }
  private async importFile(file: File) {
    this.show(0);
    if (!/\.(srt|ass|ssa|vtt)$/i.test(file.name) || file.size > 4 * 1024 * 1024) { this.status("4 MiB 이하의 SRT, ASS, SSA 또는 VTT 파일을 선택하세요", true); return }
    const signal = this.busy(); this.status("자막 불러오는 중…", false, true);
    try {
      const text = await this.text(await fetch(`/api/subtitles/convert?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, signal }));
      await this.attach(text, file.name, `file:${file.name}:${file.size}:${file.lastModified}`, signal);
      if (!signal.aborted) { this.show(0); this.status(`불러옴 ${file.name}`) }
    } catch (error) { if (!signal.aborted) this.status(error instanceof Error ? error.message : "자막을 불러오지 못했습니다", true) }
  }

  private searchPanel() {
    this.request?.abort();
    this.page = 'search';
    const item = this.player.peachItem;
    const query = String(item?.code || item?.title || String(item?.name || '').replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts|wmv)$/i, '')).trim().slice(0, 200);
    if (query !== this.query) { this.query = query; this.offset = 0; this.results = []; this.searched = false }
    const panel = this.panel(this.header("중국어 자막 검색") + "<div class=\"vjs-peach-subtitle-search\"><p class=\"vjs-peach-subtitle-status\" data-subtitle-status role=\"status\" hidden></p><div data-subtitle-results></div><a href=\"https://www.subtitlecat.com\" target=\"_blank\" rel=\"noopener noreferrer\">중국어 자막은 SubtitleCat에서 제공하며 기계 번역을 포함할 수 있습니다</a></div>", () => { this.request?.abort(); this.show(-1) });
    if (query.length < 3) { this.status("현재 항목에 검색할 품번이나 제목이 없습니다"); return }
    if (this.searched) this.searchResults(panel);
    else void this.runSearch(panel, 0);
  }

  private searchResults(panel: HTMLElement) {
    const list = panel.querySelector<HTMLElement>('[data-subtitle-results]')!;
    list.innerHTML = this.results.map((row, index) => `<button type="button" class="vjs-peach-subtitle-result" data-subtitle-result="${index}"><span>${esc(row.title)}</span><small>${esc([row.language, row.format].filter(Boolean).join(' · '))}</small></button>`).join('') +
      (this.more ? "<button type=\"button\" class=\"vjs-peach-caption-action\" data-subtitle-more>자막 더 보기</button>" : '');
    list.querySelectorAll<HTMLButtonElement>('[data-subtitle-result]').forEach(button => { button.onclick = () => { void this.showFiles(this.results[Number(button.dataset.subtitleResult)]!) } });
    list.querySelector<HTMLButtonElement>('[data-subtitle-more]')?.addEventListener('click', () => { void this.runSearch(panel, this.offset + 6) });
    this.status(this.results.length ? `검색됨 ${this.results.length} 개 중국어 자막` : this.more ? "현재 결과에 중국어가 없습니다. 더 많은 자막을 확인하세요" : "현재 항목의 중국어 자막을 찾지 못했습니다");
  }

  private async runSearch(panel: HTMLElement, offset = this.offset) {
    if (panel.getAttribute('aria-busy') === 'true') return;
    const signal = this.busy(), generation = this.generation;
    const trigger = panel.querySelector<HTMLButtonElement>('[data-subtitle-more],[data-subtitle-retry]');
    const list = panel.querySelector<HTMLElement>('[data-subtitle-results]')!;
    panel.setAttribute('aria-busy', 'true'); if (trigger) setActionBusy(trigger); list.inert = true; this.status("자막 검색 중…", false, true);
    try {
      const payload = await api(`/api/subtitles/search?q=${encodeURIComponent(this.query)}&offset=${offset}`, { signal }) as { results: SearchResult[]; more: boolean };
      if (signal.aborted || generation !== this.generation) return;
      this.offset = offset; this.results.push(...payload.results); this.more = payload.more; this.searched = true;
      this.searchResults(panel);
    } catch (error) {
      if (!signal.aborted && generation === this.generation) {
        this.status(error instanceof Error ? error.message : "자막 검색에 실패했습니다", true);
        list.querySelector('[data-subtitle-more]')?.remove();
        list.querySelector('[data-subtitle-retry]')?.remove();
        list.insertAdjacentHTML('beforeend', "<button type=\"button\" class=\"vjs-peach-caption-action\" data-subtitle-retry>다시 시도</button>");
        list.querySelector<HTMLButtonElement>('[data-subtitle-retry]')!.onclick = () => { void this.runSearch(panel, offset) };
      }
    } finally { panel.removeAttribute('aria-busy'); if (trigger) setActionBusy(trigger, false); list.inert = false }
  }

  private async showFiles(result: SearchResult) {
    this.page = 'files';
    const panel = this.panel(this.header("자막 파일 선택") + '<div class="vjs-peach-panel-menu" data-subtitle-files></div><p class="vjs-peach-subtitle-status" data-subtitle-status role="status"></p>', () => { void this.searchPanel() });
    const signal = this.busy(), generation = this.generation; this.status("자막 파일 읽는 중…", false, true);
    try {
      const payload = await api(`/api/subtitles/subtitlecat/${result.id}`, { signal }) as { files: SubtitleFile[] };
      if (signal.aborted || generation !== this.generation) return;
      const files = payload.files.filter(file => file.playable);
      panel.querySelector('[data-subtitle-files]')!.innerHTML = files.map(file => `<button type="button" class="vjs-peach-subtitle-result" data-subtitle-online="${file.index}"><span>${esc(file.name)}</span><small>${esc(file.language)}</small></button>`).join('');
      this.status(files.length ? "불러올 자막 선택" : "이 결과에는 불러올 수 있는 텍스트 자막이 없습니다");
      panel.querySelectorAll<HTMLButtonElement>('[data-subtitle-online]').forEach(button => {
        button.onclick = () => { const file = files.find(row => row.index === Number(button.dataset.subtitleOnline))!; void this.loadOnline(result.id, file) };
      });
    } catch (error) { if (!signal.aborted && generation === this.generation) this.status(error instanceof Error ? error.message : "자막 파일을 가져오지 못했습니다", true) }
  }

  private async loadOnline(id: string, file: SubtitleFile) {
    const signal = this.busy(); this.status("자막 불러오는 중…", false, true);
    try {
      const key = `subtitlecat:${id}:${file.index}`, existing = this.imported.get(key);
      if (existing) this.select(existing.node.track);
      else await this.attach(await this.text(await fetch(`/api/subtitles/subtitlecat/${id}/${file.index}`, { signal })), file.name, key, signal);
      if (!signal.aborted) { this.show(0); this.status(`불러옴 ${file.name}`) }
    } catch (error) { if (!signal.aborted) this.status(error instanceof Error ? error.message : "자막을 불러오지 못했습니다", true) }
  }

}
