// The voice volume window (her menu's Voice > Voice volume): a slider for her spoken voice only,
// 0 to 200 %, saved as you drag; her other sounds keep the main volume.

const host = window.host;
const slider = document.getElementById('slider');
const pct = document.getElementById('pct');

const show = (value) => { pct.textContent = `${value}%`; };

let timer = 0;
function save(value) {
  show(value);
  clearTimeout(timer);
  timer = setTimeout(() => host.setConfig({ voiceVolume: value / 100 }), 60); // not on every pixel of the drag
}

host.getConfig().then((cfg) => {
  const value = Math.round((cfg.voiceVolume ?? 1) * 100);
  slider.value = String(value);
  show(value);
});

slider.addEventListener('input', () => save(Number(slider.value)));
document.getElementById('reset').addEventListener('click', () => {
  slider.value = '100';
  save(100);
});
document.getElementById('test').addEventListener('click', () => host.voiceTest());
