import React, { useEffect, useState } from 'react';
import { describeModelMemory } from './hardwareDisplay.mjs';

export default function OllamaMemory({ baseURL, revision }) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const models = await window.paperBridge.runningModels(baseURL);
        if (current) setSnapshot({ baseURL, revision, models });
      } catch {
        if (current) setSnapshot({ baseURL, revision, unavailable: true });
      }
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [baseURL, revision]);

  let detail;
  if (!snapshot || snapshot.baseURL !== baseURL || snapshot.revision !== revision) detail = 'Checking loaded Ollama models…';
  else if (snapshot.unavailable) detail = 'Could not read model memory from this Ollama endpoint.';
  else if (!snapshot.models.length) detail = 'No Ollama models are loaded. Run a local AI task, then check again.';
  else detail = snapshot.models.map(model => <span key={model.name} style={{ display: 'block' }}>{model.name} · {describeModelMemory(model)}</span>);
  return <p aria-label="Ollama model memory" role="status">{detail}</p>;
}
