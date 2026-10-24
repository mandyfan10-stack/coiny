import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoMessagePlayer } from '../../src/components/chat/mediaPlayers';
import '../../src/index.css';
function Harness() {
  const [shown, setShown] = useState(true);
  return <><button onClick={() => setShown(value => !value)}>Показать / скрыть</button>
    {shown && <VideoMessagePlayer videoUrl="/tests/ui/assets/message-video.mp4"/>}</>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
