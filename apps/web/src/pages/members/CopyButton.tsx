import { Button } from '@whiteboard/ui';
import { useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: the text is selectable on screen
    }
  }
  return (
    <Button variant="secondary" onClick={() => void copy()}>
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
