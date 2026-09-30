// Illustration only: switching steps never executes commands or contacts a service.
const steps = [
  { workspace: 'main', branch: 'main', path: '~/Projects/orbit-web', command: 'npm run dev', badge: 'DEV SERVER', tab: 'dev server', state: 'RUNNING', output: '$ npm run dev\n\nLocal: http://localhost:5173/\n\nReady. Watching for changes.', caption: 'Main has its own dev process. It stays running when you switch workspaces.' },
  { workspace: 'feature', branch: 'feature/search', path: '~/Projects/orbit-web-search', command: 'npm test', badge: 'FEATURE WORKTREE', tab: 'zsh · tests', state: 'FINISHED', output: '$ npm test\n\n✓ filters results by query\n✓ clears the search field\n\n2 tests passed.\n$', caption: 'The feature worktree has its own directory and terminal. Main’s dev process keeps running.' },
  { workspace: 'main', branch: 'main', path: '~/Projects/orbit-web', command: 'npm run dev', badge: 'BACK ON MAIN', tab: 'dev server', state: 'STILL RUNNING', output: '$ npm run dev\n\nLocal: http://localhost:5173/\n\nReady. Watching for changes.', caption: 'You are back at the same running dev process. No need to start it again.' }
];
let current = 0;
const buttons = [...document.querySelectorAll('[data-step]')];
function showStep(index) {
  current = index;
  const step = steps[index];
  buttons.forEach((button, position) => {
    button.classList.toggle('selected', position === index);
    button.setAttribute('aria-pressed', String(position === index));
  });
  document.querySelectorAll('[data-workspace]').forEach(row => row.classList.toggle('active', row.dataset.workspace === step.workspace));
  for (const field of ['branch', 'path', 'command', 'badge', 'tab', 'state', 'output', 'caption']) document.getElementById(`demo-${field}`).textContent = step[field];
  const next = document.getElementById('demo-next');
  next.textContent = index === steps.length - 1 ? 'Start again ↺' : 'Next step →';
  next.setAttribute('aria-label', index === steps.length - 1 ? 'Restart walkthrough' : 'Next walkthrough step');
}
buttons.forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.step))));
document.getElementById('demo-next').addEventListener('click', () => showStep((current + 1) % steps.length));
