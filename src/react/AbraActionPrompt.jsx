import React, { useState } from "react";
import actionsJson from '../actions.json';
import { executeAction } from '../actions/executor';

export function AbraActionPrompt({ backendUrl }) {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleExecute = async () => {
    setIsLoading(true);
    setStatus("Resolving action...");
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${backendUrl}/api/resolve-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIntent: input, actions: actionsJson.actions })
      });

      const aiResponse = await res.json();

      setStatus(`Action: ${aiResponse.action}`);

      const executionResult = await executeAction(aiResponse.action, aiResponse.params);

      if (executionResult.success) {
        setResult(executionResult.result);
        setStatus(`✅ Executed: ${aiResponse.action}`);
      } else {
        throw new Error(executionResult.error);
      }
    } catch (err) {
      setError(err.message);
      setStatus("Failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="abra-container">
      <input value={input} onChange={(e) => setInput(e.target.value)} disabled={isLoading} />
      <button onClick={handleExecute} disabled={isLoading}>Execute</button>

      {status && <p>{status}</p>}
      {error && <p>{error}</p>}
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
