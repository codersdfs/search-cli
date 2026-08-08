import { launchBrowser } from './src/tui';

process.on('exit', (code) => {
  console.error('process.exit called with code:', code);
});

console.error('About to launch browser...');
try {
  await launchBrowser();
  console.error('Browser launched successfully');
} catch (e) {
  console.error('Error launching browser:', e);
  console.error('Stack:', e?.stack);
  process.exit(1);
}
