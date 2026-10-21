import { createRoot } from 'react-dom/client';
import '@fontsource/kalam/latin-400.css';
import '@fontsource/kalam/latin-700.css';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './styles.css';
import { App } from './App';

// make sure canvas text uses the hand fonts from the first frame
Promise.allSettled(['400 20px Kalam', '600 20px Caveat', '700 20px Nunito'].map((f) => document.fonts.load(f))).finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
