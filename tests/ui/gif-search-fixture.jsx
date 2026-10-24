import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MediaPickerPanel from '../../src/components/chat/MediaPickerPanel';
import '../../src/index.css';
function Harness() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  return <div style={{ position: 'fixed', bottom: 0, right: 0, width: '100%', height: 60 }}>
    <button className="emoji-trigger" onClick={() => setOpen(true)}>Открыть GIF</button>
    <output data-testid="selected-gif">{selected}</output>
    <MediaPickerPanel isOpen={open} onClose={() => setOpen(false)} onSelectGif={setSelected}/>
  </div>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
