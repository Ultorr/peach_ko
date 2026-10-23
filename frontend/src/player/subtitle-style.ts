/* 字幕外观持久化与 TextTrack 时间轴显示。 */
export const CAPTION_OPTIONS = {
  font: { label: "글꼴", values: [['sans', "고딕체"], ['mono', "고정폭 고딕체"], ['serif', "명조체"], ['mono-serif', "고정폭 명조체"], ['casual', "캐주얼"], ['cursive', "손글씨"], ['small-caps', "작은 대문자"]] },
  size: { label: "글자 크기", values: ['50', '75', '100', '150', '200', '300', '400'].map(value => [value, `${value}%`]) },
  color: { label: "글자 색", values: [['white', "흰색"], ['yellow', "노란색"], ['green', "초록색"], ['cyan', "청록색"], ['blue', "파란색"], ['magenta', "마젠타"], ['red', "빨간색"], ['black', "검은색"]] },
  opacity: { label: "글자 불투명도", values: ['25', '50', '75', '100'].map(value => [value, `${value}%`]) },
  background: { label: "배경색", values: [['black', "검은색"], ['white', "흰색"], ['red', "빨간색"], ['green', "초록색"], ['blue', "파란색"], ['yellow', "노란색"], ['magenta', "마젠타"], ['cyan', "청록색"]] },
  backgroundOpacity: { label: "배경 불투명도", values: ['0', '25', '50', '75', '100'].map(value => [value, `${value}%`]) },
  window: { label: "창 색", values: [['black', "검은색"], ['white', "흰색"], ['red', "빨간색"], ['green', "초록색"], ['blue', "파란색"], ['yellow', "노란색"], ['magenta', "마젠타"], ['cyan', "청록색"]] },
  windowOpacity: { label: "창 불투명도", values: ['0', '25', '50', '75', '100'].map(value => [value, `${value}%`]) },
  edge: { label: "글자 가장자리 스타일", values: [['none', "없음"], ['raised', "양각"], ['depressed', "음각"], ['outline', "윤곽선"], ['shadow', "그림자"]] },
} as const;
export type CaptionKey = keyof typeof CAPTION_OPTIONS;
export type CaptionStyle = Record<CaptionKey, string>;
const DEFAULTS: CaptionStyle = { font: 'sans', size: '100', color: 'white', opacity: '100', background: 'black', backgroundOpacity: '75', window: 'black', windowOpacity: '0', edge: 'shadow' };
const KEY = 'peach.caption-style.v1';
const COLORS: Record<string, string> = { white: '255,255,255', yellow: '255,255,0', green: '0,255,0', cyan: '0,255,255', blue: '0,0,255', magenta: '255,0,255', red: '255,0,0', black: '0,0,0' };
const FONTS: Record<string, string> = { sans: 'Arial,sans-serif', mono: 'Consolas,monospace', serif: 'Georgia,serif', 'mono-serif': '"Courier New",monospace', casual: '"Comic Sans MS",sans-serif', cursive: 'cursive', 'small-caps': 'Arial,sans-serif' };
const EDGES: Record<string, string> = { none: 'none', raised: '-1px -1px 0 #ddd,1px 1px 0 #222', depressed: '1px 1px 0 #ddd,-1px -1px 0 #222', outline: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000', shadow: '2px 2px 3px #000' };

export function readCaptionStyle(): CaptionStyle {
  let saved: Partial<CaptionStyle> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { /* 使用默认外观 */ }
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key,
    CAPTION_OPTIONS[key as CaptionKey].values.some(([value]) => value === saved[key as CaptionKey]) ? saved[key as CaptionKey] : fallback])) as CaptionStyle;
}

export function mountCaptionStyle(root: HTMLElement, video: HTMLVideoElement, signal: AbortSignal) {
  let style = readCaptionStyle();
  const overlay = document.createElement('div'); overlay.className = 'vjs-peach-captions'; overlay.setAttribute('aria-hidden', 'true');
  const window = document.createElement('div'); window.className = 'vjs-peach-caption-window'; overlay.append(window);
  root.querySelector('media-container')!.append(overlay); root.dataset.peachCaptions = '';
  const paintStyle = () => {
    const rgba = (color: string, opacity: string) => `rgba(${COLORS[color]},${Number(opacity) / 100})`;
    root.style.setProperty('--peach-caption-font', FONTS[style.font]!);
    root.style.setProperty('--peach-caption-scale', String(Number(style.size) / 100));
    root.style.setProperty('--peach-caption-color', rgba(style.color, style.opacity));
    root.style.setProperty('--peach-caption-background', rgba(style.background, style.backgroundOpacity));
    root.style.setProperty('--peach-caption-window', rgba(style.window, style.windowOpacity));
    root.style.setProperty('--peach-caption-edge', EDGES[style.edge]!);
    root.style.setProperty('--peach-caption-variant', style.font === 'small-caps' ? 'small-caps' : 'normal');
  };
  const render = () => {
    window.replaceChildren();
    for (const track of video.textTracks) {
      if (track.mode !== 'showing' || !['subtitles', 'captions'].includes(track.kind)) continue;
      for (const cue of Array.from(track.activeCues || [])) {
        const line = document.createElement('span'); line.className = 'vjs-peach-caption-line';
        if (cue instanceof VTTCue) line.append(cue.getCueAsHTML());
        window.append(line);
      }
    }
    overlay.hidden = !window.childNodes.length;
  };
  const bound = new WeakSet<TextTrack>();
  const bind = () => {
    for (const track of video.textTracks) if (!bound.has(track)) { bound.add(track); track.addEventListener('cuechange', render, { signal }) }
    render();
  };
  video.textTracks.addEventListener('addtrack', bind, { signal });
  video.textTracks.addEventListener('removetrack', bind, { signal });
  video.textTracks.addEventListener('change', render, { signal });
  paintStyle(); bind();
  return {
    current: () => style,
    set(key: CaptionKey, value: string) {
      if (!CAPTION_OPTIONS[key].values.some(([option]) => option === value)) return;
      style = { ...style, [key]: value }; paintStyle();
      try { localStorage.setItem(KEY, JSON.stringify(style)) } catch { /* 当前会话保留外观 */ }
    },
    reset() { style = { ...DEFAULTS }; paintStyle(); try { localStorage.removeItem(KEY) } catch { /* 当前会话保留外观 */ } },
  };
}
