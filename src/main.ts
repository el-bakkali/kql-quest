import './styles.css';
import { startGame } from './game';
import { isTouchDevice } from './game/virtualInput';
import { mountTouchControls } from './ui/touchControls';

const parent = document.getElementById('game');
if (!parent) throw new Error('Missing #game container');

document.getElementById('boot-note')?.remove();

if (isTouchDevice()) {
  document.body.classList.add('is-touch');
  mountTouchControls();
  setupRotateHint();
}

startGame(parent);

function setupRotateHint() {
  const hint = document.getElementById('rotate-hint');
  const dismiss = document.getElementById('rotate-dismiss');
  if (!hint || !dismiss) return;

  let dismissed = sessionStorage.getItem('kqlquest.rotateDismissed') === '1';
  const portrait = window.matchMedia('(orientation: portrait)');

  const sync = () => {
    hint.hidden = dismissed || !portrait.matches;
  };

  dismiss.addEventListener('click', () => {
    dismissed = true;
    try {
      sessionStorage.setItem('kqlquest.rotateDismissed', '1');
    } catch {
      // Storage can be blocked; the hint just reappears next load.
    }
    sync();
  });

  portrait.addEventListener('change', sync);
  sync();
}
