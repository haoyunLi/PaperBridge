import React, { useEffect, useState } from 'react';
import { describeModelMemory } from './hardwareDisplay.mjs';

export default function OllamaMemory({ baseURL, revision }) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    let current = true, reading = false;
    let timer;
    async function refresh() {
      if (!current || document.hidden || reading) return;
      reading = true;
      try {
        const models = await window.paperBridge.runningModels(baseURL);
        if (current) setSnapshot({ baseURL, revision, models });
      } catch {
        if (current) setSnapshot({ baseURL, revision, unavailable: true });
      } finally {
        reading = false;
        if (current && !document.hidden) timer = setTimeout(refresh, 5000);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    }
    timer = setTimeout(refresh, 250);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      current = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [baseURL, revision]);

  let detail;
  if (!snapshot || snapshot.baseURL !== baseURL || snapshot.revision !== revision) detail = 'Checking loaded Ollama models…';
  else if (snapshot.unavailable) detail = 'Could not read model memory from this Ollama endpoint.';
  else if (!snapshot.models.length) detail = 'No Ollama models are loaded.';
  else detail = snapshot.models.map(model => <span key={model.name} style={{ display: 'block' }}>{model.name} · {describeModelMemory(model)}</span>);
  return <p aria-label="Ollama model memory" role="status">{detail}</p>;
}
