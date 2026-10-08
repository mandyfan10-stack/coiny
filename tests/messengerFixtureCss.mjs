import fs from 'node:fs';

/** Include shared styles explicitly: setContent documents cannot resolve Vite CSS imports. */
export function messengerFixtureCss() {
  const files = [
    'styles/tokens.css', 'styles/messenger.css', 'index.css',
    'components/ui/Controls.module.css', 'components/ui/Avatar.module.css',
    'components/Sidebar.css', 'components/ChatArea.css',
    'components/chat/ChatComposer.css', 'components/ChatInfo.css',
    'components/chat/MobileActionSheet.css', 'components/chat/ImageViewer.css'
  ];
  return files.map(file => fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
    .replace(/^@import[^;]+;/gm, '')
    .replace(/:global\(([^)]+)\)/g, '$1')).join('\n');
}
